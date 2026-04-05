# ADR-002: Horizontal Scaling Strategy

**Status:** Proposed
**Date:** 2026-04-04

## Context

Resilience currently runs as a single Fly.io machine (`shared-cpu-1x`, 1 GB RAM)
with all services co-located in one Puma process:

- **Web serving:** HTTP API + SSE streams (20 Puma threads)
- **Background jobs:** Solid Queue supervisor running as a Puma plugin (`SOLID_QUEUE_IN_PUMA=true`)
- **Telemetry simulator:** Background thread started by `config/initializers/telemetry_simulator.rb`
- **Real-time relay:** PostgreSQL `LISTEN`/`NOTIFY` threads for SSE fan-out (`Realtime::PostgresRelay`)

This architecture is appropriate for the current stage (single-digit concurrent
users, portfolio deployment) but has known scaling ceilings:

### Thread Budget Ceiling

Puma runs 20 threads (`RAILS_MAX_THREADS=20`). Each SSE stream permanently
occupies one thread. With `SSE_MAX_STREAMS_PER_IP=12`, a single office network
can consume 12 threads, leaving only 8 for API requests. The Fly load balancer
enforces `hard_limit=30` connections, but real capacity is thread-bound.

### Solid Queue Contention

Background jobs (feed ingestion, correlation evaluation, partition management,
metrics snapshots) run inside the same process as web traffic. A long-running
ACLED ingestion job competes for the same DB pool and CPU as live API requests.

### Telemetry Simulator Duplication

The simulator boots as a background thread via an initializer. If multiple Puma
instances are launched, each runs its own simulator, producing duplicate telemetry
data with no deduplication mechanism.

## Scaling Path

### Phase 1: Vertical Scaling (No Code Changes)

Increase the Fly.io machine size and thread count:

```toml
# fly.toml
[[vm]]
  size   = "shared-cpu-2x"
  memory = "2gb"

[env]
  RAILS_MAX_THREADS = "48"
```

This doubles capacity with zero code changes. DB pool auto-scales via
`database.yml` (`pool: ENV["RAILS_MAX_THREADS"]`).

**When to trigger:** Thread pool saturation visible in Puma stats or SSE admission
denials appearing in logs.

### Phase 2: Separate Job Worker (Moderate Effort)

Split Solid Queue into a dedicated Fly.io process:

```toml
# fly.toml — web process
[env]
  SOLID_QUEUE_IN_PUMA = "false"

# fly.toml — worker process (separate machine or process group)
[processes]
  worker = "bundle exec rails solid_queue:start"
```

**What changes:**
- Web machine handles only HTTP + SSE
- Worker machine processes feed ingestion, correlation evaluation, metrics, partition jobs
- Both share the same Fly Postgres database
- No code changes required — Solid Queue is already database-backed and supports
  multi-process polling natively

**Telemetry simulator:** Guard it to run only on the web process
(`SimulatorService.boot!` already checks `server_process?`, so it won't
start on a dedicated queue worker).

**When to trigger:** Job queue latency exceeding 5 seconds, or feed ingestion
delaying time-sensitive correlation evaluation.

### Phase 3: Multiple Web Machines (Moderate Effort)

Add a second Fly.io web machine:

```toml
[http_service]
  min_machines_running = 2
```

**What already works cross-instance:**
- **Solid Queue:** Database-backed polling — jobs automatically distribute
- **SSE fan-out:** `Realtime::PostgresRelay` uses `pg_notify()`, which delivers
  to all `LISTEN` connections regardless of which Puma instance they're on.
  Each instance's `Sse::Broadcaster` receives relay messages and pushes to its
  local SSE clients. This means SSE already works cross-machine.
- **SSE admission:** `Sse::StreamAdmission` uses a PostgreSQL advisory lock
  (`pg_advisory_xact_lock`) and the `sse_stream_leases` table, both of which
  are database-level. Per-user and per-IP limits are enforced globally across
  all instances.
- **Authentication:** JWT tokens are stateless. `revoked_jwts` and
  `tokens_valid_after` are DB-checked. Session revocation works cross-instance.

**What needs attention:**
- **Telemetry simulator:** Only one instance should run the simulator. Options:
  (a) Use an env var (`TELEMETRY_SIMULATOR_ENABLED=true`) set only on one machine,
  (b) Move the simulator to a Solid Queue recurring job with an advisory lock
  (same pattern as `Correlations::EvaluationJob`).
- **Request-level metrics:** `Metrics::Recorder` stores request latency samples
  in process-local memory (`@request_samples`). With multiple machines, each
  instance snapshots only its own samples. The aggregated view in
  `OperationalStatus` would show whichever instance last ran `SnapshotJob`.
  Fix: Move sample accumulation to a database-backed counter or accept per-instance
  snapshots as sufficient at this scale.

### Phase 4: Hard Tenant Isolation (Significant Effort)

Currently, `organization_id` is nullable — `nil` means "see all data." This
is the opt-in tenant model, appropriate for single-org deployments.

For hard multi-tenant isolation:
1. Make `organization_id` NOT NULL on `users` and `sites` (migration + data backfill)
2. Add a default "Global" organization for unscoped records
3. Add `organization_id` to `AreaOfOperation`, `Incident`, `Task` (denormalized
   for query performance — currently inferred through site joins)
4. Enforce at the database level with row-level security (RLS) policies keyed
   on `current_setting('app.current_org_id')`, set per-request in a `before_action`
5. Remove the `null = unrestricted` fallback from `ApplicationPolicy::Scope`

**When to trigger:** When multiple distinct organizations need guaranteed data
isolation (regulatory, contractual, or security requirement).

## What This Architecture Does NOT Need

- **Redis:** PostgreSQL `NOTIFY` handles pub/sub for SSE. Solid Queue uses
  database polling. Adding Redis would increase operational complexity without
  meaningful benefit at this scale.
- **ActionCable:** SSE streams use raw `ActionController::Live` with Puma
  threads. ActionCable would require a WebSocket upgrade and Redis, solving a
  problem that doesn't exist yet.
- **Microservices:** The service layer (`ApplicationService` + `ServiceResult`)
  provides clear boundaries. Extracting services into separate processes would
  add network latency and deployment complexity without proportional benefit.

## Decision

Adopt the phased approach above. Each phase is triggered by observable symptoms
(thread saturation, job latency, tenant requirements), not by speculative
capacity planning. The current architecture's database-centric coordination
(advisory locks, `pg_notify`, Solid Queue polling) means Phases 1–3 require
minimal code changes.

## Monitoring Triggers

| Symptom | Phase | Action |
|---------|-------|--------|
| Thread pool > 80% utilization | 1 | Increase VM size and thread count |
| SSE admission denials in logs | 1 or 3 | Increase threads or add machine |
| Job queue latency > 5s | 2 | Separate job worker process |
| Feed ingestion overlapping API slowdown | 2 | Separate job worker |
| > 30 concurrent connections | 3 | Add second web machine |
| Multi-org data isolation requirement | 4 | Implement hard tenant walls |
