#!/usr/bin/env bash
# Production-shape load-test driver for Tranche B (2026-05).
#
# Runs against a Rails server already populated by `rake load_test:seed`
# (10K sites / 100K signals / 10K audit events). Designed to be pointed
# at a separate Fly machine (resilience-loadtest), not at production
# resilience-ops. The original run.sh keeps the laptop-shape scenarios
# from 2026-04-25 unchanged; this driver is purpose-built for the
# production-shape volumes and the additional endpoints the reviewers
# called out (incidents, recommendations, replay, SSE).
#
# Server-side env required on the loadtest deploy:
#   API_IP_REQUESTS_PER_MINUTE=100000  # bypass the dashboard 300/min cap
#                                        for single-source-IP capacity test
#                                        (production traffic spreads across
#                                        many IPs each under their own budget)
#   SSE_MAX_STREAMS_PER_USER=100       # default 8 — too low for 50-conn fanout
#   SSE_MAX_STREAMS_PER_IP=100         # default 24 — same reason
#   CORS_ORIGINS=http://localhost:5173 # match the harness LOGIN_ORIGIN
#                                        (override harness if app uses
#                                        a different origin)
#
# Exit codes:
#   0 — all scenarios completed (does not assert on numbers)
#   1 — server unreachable, login failed, or rack-attack throttled the probe

set -euo pipefail

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1:3000}"
LOGIN_EMAIL="${LOGIN_EMAIL:-loadtest-admin@loadtest.local}"
LOGIN_PASSWORD="${LOGIN_PASSWORD:-loadtest-password-123}"

# ── Output directory ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results/production-shape-$(date +%Y-%m-%d_%H%M%S)"
mkdir -p "${RESULTS_DIR}"
echo "Writing results to: ${RESULTS_DIR}"
echo "Target: http://${BACKEND_HOST}"

# ── Health check ────────────────────────────────────────────────────────
status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
              "http://${BACKEND_HOST}/up" || echo "000")
if [ "$status" != "200" ]; then
  echo "ERROR: Rails server not responding at ${BACKEND_HOST} (got: $status)"
  echo "Check the target is up: flyctl status --app resilience-loadtest"
  exit 1
fi

# ── Capture a JWT cookie for authenticated scenarios ────────────────────
LOGIN_BODY="${RESULTS_DIR}/login.json"
COOKIE_JAR="${RESULTS_DIR}/cookies.txt"
cat > "${LOGIN_BODY}" <<EOF
{"session":{"email":"${LOGIN_EMAIL}","password":"${LOGIN_PASSWORD}"}}
EOF

# Origin must match the server's CORS_ORIGINS allowlist
# (sessions_controller.rb#browser_origin_permitted?). Default is the dev
# allowlist value (http://localhost:5173). The Fly loadtest deploy must
# either match this or set CORS_ORIGINS to include LOGIN_ORIGIN.
LOGIN_ORIGIN="${LOGIN_ORIGIN:-http://localhost:5173}"

curl -s -X POST "http://${BACKEND_HOST}/api/auth/login" \
  -H "Content-Type: application/json" \
  -H "Origin: ${LOGIN_ORIGIN}" \
  -d "@${LOGIN_BODY}" \
  -c "${COOKIE_JAR}" > /dev/null

JWT=$(grep _resilience_session "${COOKIE_JAR}" | awk '{print $7}')
if [ -z "$JWT" ] || [ ${#JWT} -lt 50 ]; then
  echo "ERROR: failed to capture session cookie from ${BACKEND_HOST}/api/auth/login"
  echo "       Make sure load_test:seed has run and the loadtest-admin user exists."
  head -5 "${COOKIE_JAR}" || true
  exit 1
fi
echo "Captured JWT (length=${#JWT})"

# ── Capture a known site_id and incident_id from the API itself ─────────
SITE_ID=$(curl -s -H "Cookie: _resilience_session=${JWT}" \
                "http://${BACKEND_HOST}/api/sites" \
          | python3 -c 'import sys, json; d=json.load(sys.stdin); print(d["data"][0]["id"])' \
          2>/dev/null || true)
if [ -z "$SITE_ID" ]; then
  echo "ERROR: could not extract a site_id from /api/sites response"
  exit 1
fi
echo "Captured SITE_ID=${SITE_ID}"

INCIDENT_ID=$(curl -s -H "Cookie: _resilience_session=${JWT}" \
                    "http://${BACKEND_HOST}/api/incidents" \
              | python3 -c 'import sys, json; d=json.load(sys.stdin); print(d.get("data", [{}])[0].get("id", ""))' \
              2>/dev/null || true)
if [ -z "$INCIDENT_ID" ]; then
  echo "  (no incidents present — incident-detail scenario will be skipped)"
else
  echo "Captured INCIDENT_ID=${INCIDENT_ID}"
fi

# AS_OF for replay-mode scenarios — 24h before now in UTC ISO8601.
AS_OF=$(python3 -c "import datetime, urllib.parse; \
  print(urllib.parse.quote((datetime.datetime.utcnow() - datetime.timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ')))")
echo "Replay AS_OF=${AS_OF}"

# ──────────────────────────────────────────────────────────────────────────
# Read-path scenarios. Each runs a c=N concurrent burst against an
# already-warm server. ab returns p50/p95/p99 in its output; we tee the
# raw output so the percentiles are inspectable post-run.
# ──────────────────────────────────────────────────────────────────────────

run_ab() {
  local label="$1"
  local n="$2"
  local c="$3"
  local path="$4"
  local outfile="${RESULTS_DIR}/${label}.txt"

  echo ""
  echo "=== ${label}: GET ${path} — n=${n}, c=${c} ==="
  ab -n "${n}" -c "${c}" -H "Cookie: _resilience_session=${JWT}" \
     "http://${BACKEND_HOST}${path}" 2>&1 \
     | tee "${outfile}" | tail -22
}

# ── Scenario PS-1: GET /api/sites at c=50 ───────────────────────────────
# 10K sites in the dataset; index page returns the first 100 by default.
# c=50 saturates a 4 vCPU / 4 GB machine running puma threads=20.
run_ab "ps-01-sites-c50"      2000 50 "/api/sites"

# ── Scenario PS-2: GET /api/sites/:id at c=50 ───────────────────────────
# Single-row read with serializer overhead, exercises Rails routing +
# Pundit policy + Site#serialize_for path.
run_ab "ps-02-site-detail-c50" 2000 50 "/api/sites/${SITE_ID}"

# ── Scenario PS-3: GET /api/incidents at c=20 ───────────────────────────
# Heavier than sites — joins to assignees and rule matches.
run_ab "ps-03-incidents-c20"   1000 20 "/api/incidents"

# ── Scenario PS-4: GET /api/sites?as_of=PAST at c=20 ────────────────────
# Replay-mode read. Hits Replay::ProjectionService and reconstructs
# state from the audit chain. This is the path the reviewers said was
# never proved under load.
run_ab "ps-04-sites-replay-c20" 500 20 "/api/sites?as_of=${AS_OF}"

# ── Scenario PS-5: GET /api/recommendations at c=10 ─────────────────────
# Lower concurrency — recommendations is heavier per request and the
# index returns at most ~50 rows.
run_ab "ps-05-recommendations-c10" 500 10 "/api/recommendations"

# ── Scenario PS-6: GET /api/incidents/:id at c=20 (if available) ────────
if [ -n "$INCIDENT_ID" ]; then
  run_ab "ps-06-incident-detail-c20" 500 20 "/api/incidents/${INCIDENT_ID}"
fi

# ──────────────────────────────────────────────────────────────────────────
# Scenario PS-7: SSE concurrency (50 long-lived /api/events connections).
#
# ab can't drive a long-lived stream. Spawn 50 background curl
# connections to /api/events, hold them for 30s, then SIGTERM. Count
# how many opened with HTTP 200, how many got 401/429/5xx, and report
# wall-clock duration each one survived.
# ──────────────────────────────────────────────────────────────────────────
echo ""
echo "=== ps-07-sse-fanout: 50 concurrent SSE connections, 30s hold ==="
SSE_OUT="${RESULTS_DIR}/ps-07-sse-fanout.txt"
SSE_PIDS=()
SSE_LOGDIR="${RESULTS_DIR}/sse-logs"
mkdir -p "${SSE_LOGDIR}"

# Get a fresh sse_token per connection (the production app uses a separate
# short-lived SSE token, not the session cookie — see sse_tokens_controller).
# The token endpoint is cheap and POST-only.
echo "  fetching SSE tokens..." > "${SSE_OUT}"
for i in $(seq 1 50); do
  TOKEN=$(curl -s -X POST -H "Cookie: _resilience_session=${JWT}" \
                "http://${BACKEND_HOST}/api/sse_token" \
          | python3 -c 'import sys, json; d=json.load(sys.stdin); print(d.get("token", ""))' 2>/dev/null || true)
  if [ -z "$TOKEN" ]; then
    # Fallback: many SSE endpoints accept the session cookie directly. If
    # /api/sse_token is missing or empty, just use the session cookie.
    TOKEN=""
  fi

  # Spawn a backgrounded curl that holds the connection for 30s, then exits.
  # `--max-time 30` caps the connection. `-N` disables buffering so the
  # initial HTTP status hits stdout fast. Output lands in a per-connection
  # log we can summarise after.
  if [ -n "$TOKEN" ]; then
    URL="http://${BACKEND_HOST}/api/events?token=${TOKEN}"
  else
    URL="http://${BACKEND_HOST}/api/events"
  fi
  curl -s -N -m 30 -w "HTTP_CODE=%{http_code}\n" \
       -H "Cookie: _resilience_session=${JWT}" \
       "${URL}" > "${SSE_LOGDIR}/conn-${i}.log" 2>&1 &
  SSE_PIDS+=("$!")
done

echo "  spawned ${#SSE_PIDS[@]} background SSE connections, waiting 30s..."
# Wait for all to finish (max-time will end them).
for pid in "${SSE_PIDS[@]}"; do
  wait "$pid" 2>/dev/null || true
done

# Summarise: count how many had HTTP_CODE=200 vs other.
# macOS ships bash 3.2 — no associative arrays. Aggregate the codes via
# sort | uniq -c instead, which works on every Unix.
TOTAL=0
HTTP_200=0
HTTP_OTHER=0
CODES_TMP="${SSE_LOGDIR}/_codes.txt"
: > "${CODES_TMP}"
for log in "${SSE_LOGDIR}"/conn-*.log; do
  TOTAL=$((TOTAL + 1))
  code=$(grep -oE 'HTTP_CODE=[0-9]+' "${log}" | tail -1 | sed 's/HTTP_CODE=//')
  if [ -z "$code" ]; then
    code="000"
  fi
  if [ "$code" = "200" ]; then
    HTTP_200=$((HTTP_200 + 1))
  else
    HTTP_OTHER=$((HTTP_OTHER + 1))
  fi
  echo "${code}" >> "${CODES_TMP}"
done

{
  echo "SSE fanout summary:"
  echo "  total connections: ${TOTAL}"
  echo "  HTTP 200 (held to timeout): ${HTTP_200}"
  echo "  non-200: ${HTTP_OTHER}"
  echo ""
  echo "Status code breakdown (count code):"
  sort "${CODES_TMP}" | uniq -c | sort -rn
} | tee -a "${SSE_OUT}"

echo ""
echo "Done. Raw results in: ${RESULTS_DIR}"
echo ""
echo "Next: extract p50/p95/p99 from each scenario:"
echo "  for f in ${RESULTS_DIR}/ps-*.txt; do"
echo "    echo \"=== \$(basename \$f) ===\""
echo "    grep -E 'Requests per second|Time per request|50%|95%|99%' \$f"
echo "  done"
