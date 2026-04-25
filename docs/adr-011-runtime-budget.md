# ADR-011: Runtime Budget — Single-Machine Puma + SolidQueue Light Isolation

**Status:** Accepted (shipped 2026-04-25)
**Date:** 2026-04-25

## Context

The Hardening-to-95 backlog (locked 2026-04-25 between Claude Code
and Codex) flagged the web/queue runtime shape as the architectural
inconsistency that most directly maps to operational risk:

> "Web runtime and SolidQueue still share the same in-Puma /
> shared-pool operational shape. Either separate SolidQueue from
> Puma, or at minimum give it a truly isolated operational budget.
> If we keep a single-machine deployment, the boundary still needs
> to be explicit and defensible."

Pre-ADR-011 state:

- Production deploys with `SOLID_QUEUE_IN_PUMA=true` (single-machine
  Fly deployment, ~$5/mo footprint).
- Puma threads, SolidQueue worker threads, the SQ dispatcher, and
  the `Realtime::PostgresRelay` LISTEN connection all run inside
  one process — but they do **not** share one connection pool.
- Per [config/environments/production.rb](../backend/config/environments/production.rb):
  `config.solid_queue.connects_to = { database: { writing: :queue } }`.
  This routes SolidQueue's connections to a separate `:queue` pool
  backed by the `resilience_production_queue` database.
- Pool sizing was documented prose-style in `puma.rb` comments but
  not enforced. Drift in any one of `RAILS_MAX_THREADS`, `DB_POOL`,
  or `JOB_CONCURRENCY` could silently break either pool's budget.
- Failure modes under budget violation:
  - Primary pool short: API requests block on
    `ActiveRecord::ConnectionTimeoutError` under SSE+request load.
  - Queue pool short: SolidQueue jobs starve dispatch under load,
    visible as recurring jobs falling behind their schedule.
- In both cases, Fly's load-balancer health checks would still
  pass and operators would see "the app is slow."

## Decision

Two layered choices, both shipped:

1. **Light isolation, not heavy.** Keep the single-machine deployment
   shape. Do not split SolidQueue into its own Fly process today.
   The decision gate for going heavy is documented below.

2. **Make the budget explicit and enforceable per pool.** Document
   the dual-pool reality. Enforce the contract at boot via a Rails
   initializer that fails loudly if either pool is short of its
   required size.

### The dual-pool runtime budget

Production runs three logical databases on the same Postgres server
(`primary`, `cache`, `queue`), each with an independent Active Record
connection pool. The pools relevant to the runtime budget:

#### Primary pool (web request path)

Consumers:
- **Puma web threads** — `RAILS_MAX_THREADS` connections potentially
  held while serving requests.
- **`Realtime::PostgresRelay` LISTEN** — 1 connection held for the
  lifetime of the SSE + telemetry broadcaster threads.
- **Headroom** — 1 connection of slack for transient extra checkouts
  (in-flight migration on boot, ad-hoc query).

```
primary_required = RAILS_MAX_THREADS + 1 (LISTEN) + 1 (headroom)
                 = 20 + 1 + 1 = 22
```

#### Queue pool (SolidQueue path)

Consumers:
- **SolidQueue worker threads** — `JOB_CONCURRENCY × 3` connections
  (3 threads per worker process per `queue.yml`).
- **SQ dispatcher** — 1 connection while polling.
- **Headroom** — 1 connection.

```
queue_required = JOB_CONCURRENCY × 3 + 1 (dispatcher) + 1 (headroom)
               = 1 × 3 + 1 + 1 = 5
```

Both pools currently inherit the same `pool:` value from the
`primary_production` YAML anchor in [database.yml](../backend/config/database.yml),
so a single `DB_POOL` env var sizes both. With the implicit default
of `RAILS_MAX_THREADS + 5 = 25`, the primary pool has 3 connections
of slack and the queue pool has 20 (oversized — this is harmless
slack, not a bug).

If a future change adds an explicit `pool:` override to the `queue:`
section, the validator must be updated to read each pool size
independently rather than assuming they're equal.

### `SOLID_QUEUE_IN_PUMA` does not change pool routing

The flag controls where SolidQueue **runs**, not which pool it uses.

- `SOLID_QUEUE_IN_PUMA=true` (current): SQ supervisor + worker(s)
  run inside the Puma process. Both pools live in this process. The
  validator checks both.
- `SOLID_QUEUE_IN_PUMA=false`: SQ runs in a separate process via
  `bin/jobs`. The web process (running this validator) only has the
  primary pool wired up. The queue pool check is skipped on the web
  side; a sibling SQ process would run its own validator covering
  the queue pool.

### The boot-time enforcement

[`backend/config/initializers/runtime_budget.rb`](../backend/config/initializers/runtime_budget.rb)
calls
[`RuntimeBudget::Validator.validate!`](../backend/app/services/runtime_budget/validator.rb)
during `after_initialize` in production. The validator:

1. Reads `RAILS_MAX_THREADS`, `JOB_CONCURRENCY`, `SOLID_QUEUE_IN_PUMA`
   from the environment.
2. Computes both pools' required sizes.
3. Compares against actual pool sizes (`ActiveRecord::Base.connection_pool.size`
   for primary, `SolidQueue::Record.connection_pool.size` for queue).
4. Raises `RuntimeBudget::Validator::InsufficientPoolError` with a
   diagnostic naming the failing pool, the required and actual
   sizes, and the breakdown that produced them.

Example failure message:

```
Runtime budget violated:
  Queue pool: have 10, need 17 (15 SQ workers + 1 dispatcher + 1 headroom).
Either increase DB_POOL, add an explicit pool override on the appropriate
database in database.yml, reduce RAILS_MAX_THREADS / JOB_CONCURRENCY,
or move SolidQueue to a separate process (SOLID_QUEUE_IN_PUMA=false +
bin/jobs in fly.toml).
See docs/adr-011-runtime-budget.md for the contract.
```

Fail-loud at boot is deliberate. A pool that's one connection short
does not break under light load — it breaks under the first burst of
real concurrency, in production, mid-shift. Crashing on boot
surfaces the misconfiguration to a deploy log entry, not an operator
incident.

### Emergency override

`RUNTIME_BUDGET_SKIP=1` disables the assertion. Documented for the
narrow case where an operator is recovering a broken deploy from
console. Should never be set as a default; if it is, the validator
spec will fail when the env is reviewed.

### Decision gate — when to go heavy

The light isolation in this ADR is correct for the current
operational shape. Move to heavy isolation (separate Fly process for
SolidQueue, dedicated machine, dedicated pool) when **any** of these
become true:

- **SSE concurrency** ever exceeds 12 simultaneous streams in steady
  state. The current `SSE_MAX_STREAMS_PER_IP=12` cap fits inside
  20 Puma threads with 8 threads of API headroom; raising it past
  12 collapses the headroom on the primary pool side.
- **`JOB_CONCURRENCY > 2`**. Each additional SQ worker process adds
  3 connections to the queue-pool requirement. The queue pool can
  absorb this via a `DB_POOL` bump until the primary side gets
  uncomfortable, but past that point the right move is to give SQ
  its own machine + pool.
- **Long-running jobs** (anything regularly exceeding 30 s) start
  starving the worker pool. Today's heaviest jobs are
  `Recommendations::GenerationJob` (~5–15 s with Anthropic latency)
  and the daily verifier; both fit comfortably inside 3 worker
  threads. A future job that needs minutes of wall time should run
  on a separate process so its DB checkout doesn't compete with
  the dispatcher's polling.
- **A second tenant's traffic** would breach the per-IP/per-user SSE
  caps. Multi-tenant scale isn't the current shape, but if a real
  acquirer pilot doubled active-operator headcount, the math goes
  there fast.

The heavy version is roughly:

- `[processes]` block in `fly.toml` with two entries: `web` and
  `worker`.
- Web process: `bin/rails server`, Puma, `SOLID_QUEUE_IN_PUMA=false`.
  Primary pool sized to Puma threads + LISTEN + headroom (≈22 with
  current config).
- Worker process: `bin/jobs`, dedicated 1 GB machine, queue pool
  sized to SQ workers + dispatcher + headroom (≈5 with current
  config).
- Two health checks. Two deploy blast radii. ~$5/mo extra.

Estimated effort: 2–3 days including Fly config, observability
wiring, and a soak period to confirm the split doesn't introduce
regressions.

## Consequences

- **Operator clarity.** A new contributor reading
  `runtime_budget.rb`, `validator.rb`, and this ADR can reproduce
  the math in 5 minutes and know exactly which pool each variable
  is sized against.
- **Deploy-time guard for both pools.** Drift in any of
  `RAILS_MAX_THREADS`, `JOB_CONCURRENCY`, or `DB_POOL` (or a future
  pool override on the queue config) crashes the next deploy in
  the affected dimension. Silent pool exhaustion under load is now
  impossible without an explicit override.
- **Cost stays at single-machine ~$5/mo** for the current
  operational shape. The decision gate for moving to heavy
  isolation is concrete and measurable, not aspirational.
- **No new abstraction tax.** The validator is one module, one
  initializer, one struct, ~150 lines combined. Subclasses don't
  exist. Operators don't have to learn a DSL.

## What this is NOT

- **Not a load test.** The budget contract is a static check, not
  empirical proof the app survives concurrent load. Tranche 5 in
  the Hardening-to-95 plan adds a load/runtime artifact (k6 or
  wrk) that exercises the contract in motion.
- **Not a replacement for observability.** A correctly-sized pool
  can still saturate; a saturated pool degrades gracefully under
  the existing Puma `worker_timeout = 300`. Real production needs
  Sentry / Grafana / `OperationalStatus` polling on top.
- **Not a multi-region story.** Single-machine Fly deployment in
  IAD. Multi-region with cross-region DB failover is ADR-002
  (Horizontal Scaling — still Proposed) territory.
- **Not a queue prioritisation story.** All SQ workers consume from
  `queues: "*"` per `queue.yml`. If a slow background job ever
  blocks a fast user-facing job, the next ADR is queue separation,
  not a budget bump.
- **Not a per-database pool sizer.** Primary and queue pools
  currently share `DB_POOL` via YAML inheritance. Splitting them
  (e.g., setting a smaller queue pool to release headroom on the
  primary) is a future option, but until JOB_CONCURRENCY grows the
  shared sizing is harmless.

## Provenance — how this ADR got its current shape

The validator originally counted SQ workers against the primary
pool, treating `SOLID_QUEUE_IN_PUMA` as a flag that toggled SQ's
contribution to a single pool. Codex's `/gate` review on the dirty
tree caught the conflation: SolidQueue's `connects_to` directive
routes its connections to the `:queue` pool regardless of process
location. The dual-pool framing in this document is the corrected
contract; the original "DB_POOL=30 because primary was off-by-one"
finding was an artifact of the bad math and was reverted in-place
before commit.
