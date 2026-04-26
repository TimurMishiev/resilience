#!/usr/bin/env bash
# Resilience load-test driver — Tranche 5A (2026-04-25).
#
# Reproduces the scenarios documented in docs/load-test.md
# against a Rails server already running on 127.0.0.1:3000.
# See that document for environment + interpretation; this
# script just runs the canned `ab` invocations and writes
# raw output to results/<date>/.
#
# Exit codes:
#   0 — all scenarios completed (does not assert on numbers)
#   1 — server unreachable or login could not capture a JWT

set -euo pipefail

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1:3000}"
LOGIN_EMAIL="${LOGIN_EMAIL:-commander@resilience.mil}"
LOGIN_PASSWORD="${LOGIN_PASSWORD:-password123}"

# ── Output directory ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results/$(date +%Y-%m-%d_%H%M%S)"
mkdir -p "${RESULTS_DIR}"
echo "Writing results to: ${RESULTS_DIR}"

# ── Health check ────────────────────────────────────────────────────────
status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
              "http://${BACKEND_HOST}/up" || echo "000")
if [ "$status" != "200" ]; then
  echo "ERROR: Rails server not responding at ${BACKEND_HOST} (got: $status)"
  echo "Bring it up first (note RACK_ATTACK_BYPASS=1 — see below):"
  echo "  RAILS_MAX_THREADS=20 PGPORT=5432 RACK_ATTACK_BYPASS=1 \\"
  echo "    bundle exec rails server -p 3000 -b 127.0.0.1"
  exit 1
fi

# ── Rack::Attack bypass check ───────────────────────────────────────────
# The driver fires hundreds of read requests in seconds. Without
# RACK_ATTACK_BYPASS=1, those requests blow through the global
# api/ip/minute = 300 budget and the artifact ends up measuring 429
# short-circuit speed instead of endpoint thread/DB saturation. The
# read scenarios MUST run against a server started with this env
# var. Login throttles stay active because the bypass is scoped to
# /api/* paths other than /api/auth/login.
#
# Probe by firing 350 unauthenticated requests at /api/sites — that
# is past the 300/min/IP api throttle ceiling, so:
#   - Bypass ON  → 350 × 401 (auth fail, throttle skipped)
#   - Bypass OFF → ~300 × 401 followed by ~50 × 429
# We only count 429s; presence of any indicates the bypass is off.
echo ""
echo "Probing Rack::Attack bypass status (350 unauthenticated /api/sites requests)..."
probe_429=0
for i in $(seq 1 350); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 \
              "http://${BACKEND_HOST}/api/sites")
  if [ "$code" = "429" ]; then
    probe_429=$((probe_429 + 1))
  fi
done
if [ "$probe_429" -gt 0 ]; then
  echo ""
  echo "ERROR: Rack::Attack throttled the probe (${probe_429} × 429 in 350-req volley)."
  echo "       The load-test driver requires RACK_ATTACK_BYPASS=1 in the"
  echo "       Rails server's environment so non-login /api throttles do"
  echo "       not corrupt the read-path measurements. Restart the server:"
  echo ""
  echo "         RAILS_MAX_THREADS=20 PGPORT=5432 RACK_ATTACK_BYPASS=1 \\"
  echo "           bundle exec rails server -p 3000 -b 127.0.0.1"
  echo ""
  echo "       Bypass is dev-env only — never activates in production"
  echo "       even if RACK_ATTACK_BYPASS=1 leaks into deploy config."
  exit 1
fi
echo "Bypass probe passed (no 429s in 350-request volley → api/ip throttle is bypassed)."

# Wait briefly so the probe traffic clears the api/ip bucket before
# the actual scenarios start. Even with bypass on this is harmless.
sleep 5

# ── Capture a JWT cookie for authenticated scenarios ────────────────────
LOGIN_BODY="${RESULTS_DIR}/login.json"
COOKIE_JAR="${RESULTS_DIR}/cookies.txt"
cat > "${LOGIN_BODY}" <<EOF
{"session":{"email":"${LOGIN_EMAIL}","password":"${LOGIN_PASSWORD}"}}
EOF

curl -s -X POST "http://${BACKEND_HOST}/api/auth/login" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d "@${LOGIN_BODY}" \
  -c "${COOKIE_JAR}" > /dev/null

JWT=$(grep _resilience_session "${COOKIE_JAR}" | awk '{print $7}')
if [ -z "$JWT" ] || [ ${#JWT} -lt 50 ]; then
  echo "ERROR: failed to capture session cookie from ${BACKEND_HOST}/api/auth/login"
  echo "First 5 lines of cookie jar:"
  head -5 "${COOKIE_JAR}" || true
  exit 1
fi
echo "Captured JWT (length=${#JWT})"

# ── Capture a known site_id from the API itself (no DB connection needed) ─
SITE_ID=$(curl -s -H "Cookie: _resilience_session=${JWT}" \
                "http://${BACKEND_HOST}/api/sites" \
          | python3 -c 'import sys, json; print(json.load(sys.stdin)["data"][0]["id"])' \
          2>/dev/null || true)
if [ -z "$SITE_ID" ]; then
  echo "ERROR: could not extract a site_id from /api/sites response"
  exit 1
fi
echo "Captured SITE_ID=${SITE_ID}"

# ── Wait for prior throttle counter window to clear ─────────────────────
# Per-email login throttle is 3/min, per-IP is 5/min. We just made
# one login above, so wait 65s before the throttle scenario to give
# the counter a clean window. Skip if SKIP_THROTTLE_WAIT=1.
if [ "${SKIP_THROTTLE_WAIT:-0}" != "1" ]; then
  echo "Sleeping 65s to clear Rack::Attack throttle window..."
  sleep 65
fi

# ── Scenario 1: login latency baseline (sub-throttle) ───────────────────
# 5 sequential logins, spaced 13 seconds apart so the per-email
# throttle (3/min) does not trip. Captures the BCrypt-bound
# happy-path latency. Total runtime ~65s.
echo ""
echo "=== Scenario 1: login latency baseline (5 logins spaced 13s apart) ==="
: > "${RESULTS_DIR}/01-login-latency.txt"
for i in $(seq 1 5); do
  curl -s -o /dev/null -w '%{time_total}\n' \
       -X POST "http://${BACKEND_HOST}/api/auth/login" \
       -H 'Content-Type: application/json' \
       -H 'Origin: http://localhost:5173' \
       -d "@${LOGIN_BODY}" \
       >> "${RESULTS_DIR}/01-login-latency.txt"
  if [ "$i" -lt 5 ]; then
    sleep 13
  fi
done
cat "${RESULTS_DIR}/01-login-latency.txt"

# ── Scenario 2: login throttle behaviour ────────────────────────────────
# After Scenario 1 we have used 5 successful logins from this IP +
# email; the IP throttle (5/min) is now spent. Wait for the window
# to clear before issuing the burst that demonstrates the throttle.
echo ""
echo "Sleeping 65s to clear Rack::Attack throttle window before burst..."
sleep 65

echo ""
echo "=== Scenario 2: login throttle (10 sequential failing logins) ==="
{
  for i in $(seq 1 10); do
    code=$(curl -s -o /dev/null -w '%{http_code}' \
                -X POST "http://${BACKEND_HOST}/api/auth/login" \
                -H 'Content-Type: application/json' \
                -H 'Origin: http://localhost:5173' \
                -d '{"session":{"email":"x@x.local","password":"wrong"}}')
    echo "req=$i status=$code"
  done
} | tee "${RESULTS_DIR}/02-login-throttle.txt"

# Wait again to clear the wrong-email throttle counter before
# authenticated read scenarios — they use a different cookie path,
# but the IP throttle would still be cooling down.
echo ""
echo "Sleeping 65s to clear IP throttle window..."
sleep 65

# ── Scenario 3a: GET /api/sites at c=1 ──────────────────────────────────
echo ""
echo "=== Scenario 3a: GET /api/sites — n=200, c=1 ==="
ab -n 200 -c 1 -H "Cookie: _resilience_session=${JWT}" \
   "http://${BACKEND_HOST}/api/sites" 2>&1 \
   | tee "${RESULTS_DIR}/03a-sites-c1.txt" | tail -22

# ── Scenario 3b: GET /api/sites at c=20 ─────────────────────────────────
echo ""
echo "=== Scenario 3b: GET /api/sites — n=500, c=20 ==="
ab -n 500 -c 20 -H "Cookie: _resilience_session=${JWT}" \
   "http://${BACKEND_HOST}/api/sites" 2>&1 \
   | tee "${RESULTS_DIR}/03b-sites-c20.txt" | tail -22

# ── Scenario 4: GET /api/sites/:id at c=20 ──────────────────────────────
echo ""
echo "=== Scenario 4: GET /api/sites/:id — n=500, c=20 ==="
ab -n 500 -c 20 -H "Cookie: _resilience_session=${JWT}" \
   "http://${BACKEND_HOST}/api/sites/${SITE_ID}" 2>&1 \
   | tee "${RESULTS_DIR}/04-site-detail.txt" | tail -22

# ── Scenario 5: GET /api/sites at c=50 (saturation) ─────────────────────
echo ""
echo "=== Scenario 5: GET /api/sites — n=500, c=50 (saturation) ==="
ab -n 500 -c 50 -H "Cookie: _resilience_session=${JWT}" \
   "http://${BACKEND_HOST}/api/sites" 2>&1 \
   | tee "${RESULTS_DIR}/05-sites-c50.txt" | tail -22

echo ""
echo "Done. Raw results in: ${RESULTS_DIR}"
echo "Interpretation: docs/load-test.md"
