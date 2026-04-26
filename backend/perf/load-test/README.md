# Backend Load-Test Driver

Reproduces the scenarios documented in
[`docs/load-test.md`](../../../docs/load-test.md). The
script (`run.sh`) hits an already-running Rails server with
`ab` and writes raw output to `results/<date>/`. Re-runs land
alongside the 2026-04-25 baseline — never overwrite — so curve
drift over time is observable.

## Quick start

```bash
# Bring the dev DB to current schema (one-time)
cd backend
PGPORT=5432 RAILS_ENV=development bundle exec rails db:migrate

# Start the Rails server with the perf bypass (background)
RAILS_MAX_THREADS=20 PGPORT=5432 RACK_ATTACK_BYPASS=1 \
  bundle exec rails server -p 3000 -b 127.0.0.1 &

# Run the loads
cd perf/load-test
./run.sh

# Stop the server
kill "$(cat ../../tmp/pids/server.pid)"
```

## Requirements

- `ab` (Apache Bench) — preinstalled on macOS at `/usr/sbin/ab`
- A Rails server reachable at `BACKEND_HOST` (default `127.0.0.1:3000`)
- A user with known credentials matching `LOGIN_EMAIL` /
  `LOGIN_PASSWORD` (defaults: `commander@resilience.mil` /
  `password123` from the dev seed)
- `python3` (for JSON parsing of the site-list response)
- **`RACK_ATTACK_BYPASS=1` in the Rails server's environment.**
  The driver fires hundreds of read requests in seconds —
  without the bypass, it blows through the global
  `api/ip/minute=300` throttle and the artifact ends up
  measuring 429 short-circuit speed instead of endpoint
  behaviour. The driver runs a 350-request probe at startup
  and aborts if any 429 comes back. The bypass is scoped to
  `Rails.env.development` AND non-login `/api/*` paths, so
  Scenarios 1+2 still demonstrate the login throttles, and
  the bypass cannot activate in production even if the env
  var leaks into deploy config.

## Environment overrides

```bash
BACKEND_HOST=127.0.0.1:4000 ./run.sh           # different port
LOGIN_EMAIL=ops@example.test ./run.sh          # different account
SKIP_THROTTLE_WAIT=1 ./run.sh                  # skip 65s waits (CI)
```

## What's NOT in scope

- **No assertions on the numbers.** This is a measurement
  tool, not a regression gate. The numbers go to
  `results/<date>/` for human review against
  [`docs/load-test.md`](../../../docs/load-test.md).
- **No write-path tests.** Every scenario is a read or a
  failed-login. Mutation paths (audit chain hashing under
  load, recommendation generation, SSE admission stress)
  warrant their own scripts.
- **No real-traffic shape.** `ab` is closed-loop (each thread
  fires one request, waits for response, fires another).
  Real users don't behave that way.

## Future migration

`ab` is a 2003-era tool. Migrating to `k6` would give us:

- HTTP scenarios with shared setup (login → fetch → SSE)
- Native histogram serialisation (HDR, exportable)
- Open-loop traffic generation (more realistic)
- JSON output for trend tracking across runs

Tracked as the last item in
[`docs/load-test.md`](../../../docs/load-test.md)'s
"Open follow-ups" list.
