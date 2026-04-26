# Resilience — Load Test Artifact (2026-04-25)

**Status:** First baseline. Single-machine numbers, captured on
the developer hardware described below. Re-runs land in
`backend/perf/load-test/results/` with date-stamped output;
this document tracks the *interpretation* — what the numbers
mean and what the system did under pressure.

This artifact closes Tranche 5A of the Hardening-to-95
initiative ("evidence under pressure" — the missing empirical
proof to complement the architectural ADRs).

## What this is NOT

- **Not production capacity numbers.** The numbers below are
  from a developer laptop (Apple M-series, single Postgres
  instance, no jemalloc, no production tuning). Absolute
  throughput / latency on a Fly 1 GB machine in IAD will
  differ; the *shape* of the curves (where saturation occurs,
  how latency ramps with concurrency, where Rack::Attack
  intercepts) translates.
- **Not a stress test to failure.** The scenarios below ramp
  to saturation, not past it. Beyond saturation, behaviour is
  defined by Puma's `worker_timeout = 300` (catch-all) and
  Fly's load-balancer `hard_limit = 25` connections (rejection
  before the app sees the request).
- **Not a soak test.** Each scenario runs for seconds to
  ~1 minute. Steady-state behaviour over hours (memory
  growth, connection-pool drift, thread eviction) is its own
  follow-up artifact.

## Environment

| Component | Value |
|---|---|
| Hardware | Apple M-series laptop, on-battery (no perf governor) |
| Ruby | per `.tool-versions` (3.4.x) |
| Rails | 8.1.3 |
| Postgres | 17.9, local (port 5432), shared dev instance |
| Tooling | `ab` 2.3 (preinstalled on macOS) |
| App env | `RAILS_ENV=development`, `RAILS_MAX_THREADS=20` |
| DB pool | implicit `RAILS_MAX_THREADS + 5 = 25` |
| Server | Puma single-process, single worker, 20 threads |
| Backend | Rails server on `127.0.0.1:3000`, no Thruster, no front-proxy |

## Dataset

The dev DB at the time of the run contained:

- **4 users** (roles: viewer, operator, commander, admin)
- **12 sites** spread across 4 areas of operation
- A pre-seeded audit log (~hundreds of rows) — **chain-hashed
  per ADR-010**, so every read scenario exercises the
  per-organization chain even though we are not measuring
  write paths here.

This is "demo-grade" data, not production-shape. With 12 sites,
the `GET /api/sites` payload is small (~5 KB). At 1000+ rows,
serialization cost would shift the numbers.

## Scenarios

### 1. Login latency baseline

```bash
# 5 sequential logins, spaced 13 seconds apart. The driver
# pre-runs an initial login (to capture a JWT for the
# authenticated read scenarios) plus a 65 s wait to clear the
# Rack::Attack window before this scenario begins.
for i in 1..5; do
  curl -s -o /dev/null -w "%{time_total}\n" -X POST \
    -H "Content-Type: application/json" -H "Origin: http://localhost:5173" \
    -d '{"session":{"email":"...","password":"..."}}' \
    http://127.0.0.1:3000/api/auth/login
  sleep 13   # not on the 5th
done
```

**Result (canonical baseline):**

```
0.287338   ← BCrypt-bound (~287 ms)
0.265199   ← BCrypt-bound (~265 ms)
0.265742   ← BCrypt-bound (~266 ms)
0.280198   ← BCrypt-bound (~280 ms)
0.265746   ← BCrypt-bound (~266 ms)
```

All five logins reach the controller; BCrypt-ruby (12 rounds)
computes the password hash and the floor settles at
~265–287 ms. The 13 s spacing keeps each login inside its own
per-IP/per-email throttle bucket; explicit throttle behaviour
is exercised in Scenario 2.

The ~265 ms floor is the defence cost of 12 BCrypt rounds
(bumping to 13 doubles it; we are already at the edge of
"feels instant").

### 2. Login throttle behaviour

```bash
# 10 sequential failing logins from the same IP. The driver
# inserts a 65 s sleep between Scenario 1 and Scenario 2 to
# let the Rack::Attack window roll over; some IP-budget may
# remain from Scenario 1 depending on bucket alignment.
for i in 1..10; do
  curl -s -o /dev/null -w "req=$i status=%{http_code}\n" \
    -X POST -H "Content-Type: application/json" \
    -d '{"session":{"email":"x@x.local","password":"wrong"}}' \
    http://127.0.0.1:3000/api/auth/login
done
```

**Result (canonical baseline):**

```
req=1  status=401   ← Rails reaches the controller, BCrypt runs, returns 401
req=2  status=401
req=3  status=401
req=4  status=429   ← Rack::Attack kicks in
req=5  status=429
req=6  status=429
req=7  status=429
req=8  status=429
req=9  status=429
req=10 status=429
```

Rack::Attack returns 429 in <2 ms (short-circuits before
Rails). The driver's prior traffic in this minute window
consumed some of the 5/min/IP budget, so the cutoff in this
run lands at request 4 rather than 6. The point of the
scenario is the *cutoff exists and short-circuits before the
controller* — the exact attempt index varies with bucket
alignment.

At ~50 ms per failed login (BCrypt + 401 render), an attacker
trying to brute-force a single account is bounded by the
tighter of the two relevant throttles
(`3/min/email` for a known target, `5/min/IP` for one source).
For an MFA-enabled account
([ADR-009 item 4](adr-009-adversarial-threat-model.md)),
brute-forcing the 6-digit TOTP after capturing a password
requires ~333,000 attempts on average — ~290 days at 3/min
to hit the 50 % probability mark. The login-throttle floor
plus TOTP MFA gives a credible password-attack story.

> **Important methodology note.** The four read scenarios below
> run against a Rails server started with `RACK_ATTACK_BYPASS=1`
> (and only in `Rails.env.development`). The bypass is scoped
> to non-login `/api/*` paths so the global `api/ip/minute=300`
> throttle does not turn the artifact into a measurement of
> 429 short-circuit speed. Production load distributes across
> many IPs each with their own per-IP budget, so the
> single-source-IP throttle is not the right ceiling for
> capacity planning anyway. The driver
> ([`run.sh`](../backend/perf/load-test/run.sh)) refuses to run
> if the bypass is not detected — it fires a 350-request
> unauthenticated probe at `/api/sites` and aborts on the
> first 429.

### 3a. Hot read path — `GET /api/sites` at c=1

```bash
ab -n 200 -c 1 -H "Cookie: _resilience_session=$JWT" \
   http://127.0.0.1:3000/api/sites
```

| Percentile | Latency (ms) |
|---|---:|
| p50 | 9 |
| p75 | 12 |
| p90 | 16 |
| p95 | 17 |
| p99 | 26 |
| max | 27 |

**Throughput:** 94 RPS at single-stream. Each request is one
DB round-trip (sites list, eager-loaded), one JSON serialise,
one auth check (JWT decode + signature verify, no DB). All
200 requests returned 200 OK with the real ~3.9 KB payload.

The single-request floor is ~9 ms — representative of
realistic operator load (one commander hitting the dashboard
periodically).

### 3b. Hot read path — `GET /api/sites` at c=20

```bash
ab -n 500 -c 20 -H "Cookie: _resilience_session=$JWT" \
   http://127.0.0.1:3000/api/sites
```

| Percentile | Latency (ms) |
|---|---:|
| p50 | 186 |
| p75 | 192 |
| p90 | 197 |
| p95 | 208 |
| p99 | 303 |
| max | 326 |

**Throughput:** 107 RPS at 20 in-flight requests. All 500
requests returned 200 OK. With 20 Puma threads serving
107 RPS, each thread averages 5.4 RPS = ~187 ms per request —
matching the observed p50 of 186 ms. The shape is exactly
what a thread-bounded Rails app produces at saturation:
queue depth = 1 most of the time, p99 stretches to 303 ms
on tail variance.

### 4. Site detail — `GET /api/sites/:id` at c=20

```bash
ab -n 500 -c 20 -H "Cookie: _resilience_session=$JWT" \
   http://127.0.0.1:3000/api/sites/$SITE_ID
```

| Percentile | Latency (ms) |
|---|---:|
| p50 | 168 |
| p75 | 174 |
| p90 | 184 |
| p95 | 195 |
| p99 | 284 |
| max | 295 |

**Throughput:** 118 RPS. Slightly faster than the list view
because there is no array-serialisation overhead — one
record, one snapshot, one JSON encode (~300 byte payload vs
the list's ~3.9 KB). All 500 returned 200 OK. The work mix
is otherwise the same: DB read, auth check, render.

### 5. Saturation — `GET /api/sites` at c=50

```bash
ab -n 500 -c 50 -H "Cookie: _resilience_session=$JWT" \
   http://127.0.0.1:3000/api/sites
```

| Percentile | Latency (ms) |
|---|---:|
| p50 | 463 |
| p75 | 468 |
| p90 | 472 |
| p95 | 478 |
| p99 | 582 |
| max | 590 |

**Throughput:** 108 RPS. RPS is essentially unchanged from
c=20 (107) — the Puma thread pool is the binding constraint
and adding 30 more concurrent requests does not give us more
thread-time. What does grow is queue depth: with 50 concurrent
requests competing for 20 threads, average wait time rises
from ~0 (c=20) to ~278 ms (c=50). p50 climbs from 186 ms to
463 ms — exactly the queue-time math: 186 ms work + 277 ms
queue.

All 500 returned 200 OK. No `ConnectionTimeoutError` even
under c=50 sustained pressure, validating the
[ADR-011](adr-011-runtime-budget.md) DB-pool budget (primary
pool requires 22; sized to 25; 3 connections of slack).

Cross-scenario comparison:

| Concurrency | RPS | p50 | p95 | p99 |
|---:|---:|---:|---:|---:|
| 1 (list) | 94 | 9 | 17 | 26 |
| 20 (list) | 107 | 186 | 208 | 303 |
| 20 (detail) | 118 | 168 | 195 | 284 |
| 50 (list, queue depth ~30) | 108 | 463 | 478 | 582 |

Read-path throughput plateaus at ~107–118 RPS once concurrency
matches the thread count. Beyond that, RPS stays flat and
latency grows linearly with queue depth — the canonical shape
for a thread-bounded Rails app.

## Failure point / ceiling

| Resource | Ceiling | Effect |
|---|---|---|
| Puma threads | 20 (config) | Read-path RPS plateau at ~110 in this run; latency grows linearly with queue depth past concurrency 20 |
| DB pool | 25 (= threads+5) | Pool exhaustion would manifest as `ConnectionTimeoutError`; not observed at c=50 |
| Login throttle (per-IP) | 5/min | 429s after the 5th attempt from one IP within a 60 s window |
| Login throttle (per-email) | 3/min | 429s after the 3rd attempt against one account within a 60 s window |
| API throttle (per-IP) | 300/min | 429s for any `/api/*` request beyond the budget; bypassed for this artifact (see methodology note above) |
| Login latency | ~265 ms | BCrypt-bound; can't go lower without weakening hash rounds |
| Read-path latency floor | ~9 ms | Single-thread baseline; mostly DB |

For the actual operator population (3–10 active commanders in
a TOC, plus ~12 SSE connections per IP), real load is on the
order of single-digit RPS at single-digit concurrency. At
that level all latencies stay in the p50=9 ms / p99=26 ms
regime — well within "feels instant."

The system starts to feel slow when **concurrent in-flight
requests** approach `RAILS_MAX_THREADS=20` — at that point
queue time dominates and p50 jumps from ~9 ms to ~180 ms.
Read throughput at that ceiling is ~107–118 RPS on this
hardware. The realistic concurrency from 3–10 active
operators is well below the saturation point.

(Throughput in RPS and concurrency in in-flight requests are
not the same thing. Saturation is driven by concurrency
relative to thread count; RPS is the rate that emerges given
the per-request work. The numbers above are the hot-read RPS
floor at saturation, not a "feels-slow at 20 RPS" claim.)

## What changed because of these results

Four observations from this baseline that landed back in code
or in this document:

1. **A new `RACK_ATTACK_BYPASS=1` dev-env safelist landed in
   [`config/initializers/rack_attack.rb`](../backend/config/initializers/rack_attack.rb).**
   Building this artifact uncovered a methodology bug in the
   first attempt: the read scenarios were firing 500 requests
   in seconds against an app with a global `api/ip/minute=300`
   throttle, so most of those requests were 429s and the
   "saturation" numbers in early drafts were just measurements
   of Rack::Attack's short-circuit speed. The bypass — scoped
   to dev env only and to non-login `/api/*` paths only — lets
   the load-test driver measure real endpoint behaviour while
   keeping login throttles intact (Scenarios 1 and 2 still
   demonstrate them). The driver
   ([`run.sh`](../backend/perf/load-test/run.sh)) refuses to
   run if it detects the bypass is off, so the artifact cannot
   accidentally regress to the 429-noise version.

2. **Login latency floor is BCrypt-dominant**, not framework
   overhead. The `~265 ms` p50 is the security tax of 12
   BCrypt rounds. Documented here so a future operator
   wondering why login feels slow has the floor named, rather
   than chasing phantom "Rails is slow" theories. No code
   change — the floor is intentional.

3. **The per-email throttle (3/min)** is tighter than the
   per-IP throttle (5/min) and is therefore the binding
   constraint on credential stuffing. Combined with TOTP MFA
   ([ADR-009 item 4](adr-009-adversarial-threat-model.md)),
   the brute-force budget against any single account is
   meaningless on operator-relevant timescales. This pinned
   the math in this document; the throttle values were
   already correct.

4. **Saturation is at concurrency ~20**, matching
   `RAILS_MAX_THREADS`. The
   [`ADR-011 runtime budget`](adr-011-runtime-budget.md)
   contract assumed this; the load test confirms it
   empirically: 20 Puma threads serving ~107–118 RPS = ~5.5
   RPS per thread = ~187 ms per request, exactly the observed
   p50. Doubling concurrency to c=50 leaves RPS flat at ~108
   and grows queue depth — p50 climbs to 463 ms (186 ms work
   + 277 ms queue) which is the queue-time math for 30 in-
   flight requests waiting on 20 threads. No
   `ConnectionTimeoutError` even at c=50, validating the
   `DB_POOL=25` budget (primary pool requires 22; 3 of slack).

## How to re-run

The scripts that produced the numbers above live in
[`backend/perf/load-test/`](../backend/perf/load-test/).
To reproduce on the same dev machine:

```bash
# 1. Bring up dev DB + apply migrations
cd backend
PGPORT=5432 RAILS_ENV=development bundle exec rails db:migrate

# 2. Start the Rails server in dev mode with the perf bypass
#    (RACK_ATTACK_BYPASS=1 — dev-env only, never activates in
#    production even if the env var leaks into deploy config).
RAILS_MAX_THREADS=20 PGPORT=5432 RACK_ATTACK_BYPASS=1 \
  bundle exec rails server -p 3000 -b 127.0.0.1 &

# 3. Run the load-test driver
cd perf/load-test
./run.sh   # writes to results/<date>/

# 4. Stop the server
kill $(cat backend/tmp/pids/server.pid)
```

Re-runs of this artifact should land their results next to the
2026-04-25 baseline — not overwrite — so curve drift over
time is observable.

## Open follow-ups

- **Soak test.** Run a 1-hour load at c=10 against the read
  path and watch RSS / DB pool / thread eviction. Looking for
  memory growth, connection leaks, GC pause patterns.
- **Mutation path under load.** Audit-event chain hashing has
  a per-organization advisory lock. At some concurrency this
  serialises mutations within an org. Quantify the ceiling
  for a realistic write rate (incident triage, recommendation
  acknowledgement, etc.).
- **Production-environment numbers.** The Fly 1 GB IAD
  machine has different CPU, different filesystem, and a
  TLS-terminating front proxy. Compare absolute numbers; the
  curve shape should match.
- **k6 migration.** `ab` is a 2003-era tool with no native
  histogram serialisation, no scripting, no scenarios with
  shared setup. Migrating the run scripts to `k6` would
  enable richer scenarios (login → fetch → SSE-stream
  patterns) and cleaner output.
