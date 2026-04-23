# ADR-004: Correlation Engine — Atomic Cooldown Claim + Compound Rules via Discriminator

**Status:** Accepted
**Date:** 2026-04-23

## Context

The correlation engine evaluates user-defined rules against every
ingested signal. A rule matches when its condition tree (single
signal or compound AND/OR across multiple signal types) is satisfied
against recent signals near a target site. On match, the engine fires:
a new `SignalRuleMatch` (alert), optionally a task, optionally an
incident escalation.

Two hard problems appear in the background-job execution path that are
easy to get wrong and expensive to get right:

### Problem 1: Exactly-once firing under concurrency

`Correlations::EvaluateRecentJob` runs every 30 seconds via SolidQueue.
In production, nothing prevents two workers from running the job
concurrently (e.g., after a job-queue restart). Without a claim
mechanism, a rule with a 60-minute cooldown could fire twice in the
same window because both workers observe `last_fired_at` before either
has updated it.

### Problem 2: Supporting compound (AND/OR) rules without a migration

Rules started as single conditions: `{ signal_type: "gps_jamming",
proximity_km: 50 }`. Later, operators needed compound rules that
combine signal types: "GPS jamming near a site AND an AIS gap on a
vessel in the same area." These compound rules have a different JSON
shape: `{ operator: "AND", conditions: [...] }`.

Two approaches to the shape change:

- **A:** Migrate every existing rule to the new shape. Every historical
  `SignalRuleMatch` breaks or needs translation.
- **B:** Support both shapes indefinitely, with a discriminator.

## Decisions

### Decision 1: Atomic cooldown via `UPDATE ... WHERE` row-lock

`RuleFiringService` claims the cooldown with a single atomic statement:

```ruby
rows_updated = CorrelationRule
  .where(id: @rule.id)
  .where("last_fired_at IS NULL OR last_fired_at <= ?", cooldown_cutoff)
  .update_all(last_fired_at: Time.current)

raise CooldownActive if rows_updated == 0
```

- If the cooldown is expired, exactly one worker's `UPDATE` gets the
  row-lock and sets `last_fired_at`. The other worker's `UPDATE` then
  sees the new `last_fired_at` and matches zero rows.
- The worker that sees `rows_updated == 0` raises `CooldownActive` and
  aborts before any side effect (alert, task, incident) runs.
- The SSE broadcast is explicitly outside the claim transaction — it's a
  post-commit side effect, fire-and-forget.

No distributed lock, no Redis dependency, no timer skew. The database
is already serializing these writes via row-lock; we use that
serialization as the coordination primitive.

**Paired invariant spec.** `rule_firing_service_spec.rb` proves the
concurrency property by stubbing the DB call to simulate the losing
write, not just the happy path.

### Decision 2: Compound rules via `operator`-key discriminator

Legacy flat rules are left alone. Compound rules are distinguished by
the presence of an `operator` key in `conditions`:

```ruby
def compound?
  conditions.is_a?(Hash) && conditions["operator"].present?
end

def normalized_conditions
  return conditions if compound?
  { "operator" => "AND", "conditions" => [conditions] }
end
```

`EvaluatorService` always calls `normalized_conditions` — it never
reads raw `conditions` directly. Flat rules are wrapped in a
single-element AND at read time (logically identical to the original
flat rule).

No migration. No rule type field. The shape itself is the discriminator.

## Consequences

- **Zero double-fires observable in production.** The claim-first
  pattern means an alert is *either* created (the winning worker's
  transaction committed) *or* not created (the losing worker's
  `rows_updated == 0` aborted before any writes). There is no middle
  state.

- **Cooldown is first-class state, not cache.** `last_fired_at` is on
  the `correlation_rules` row. It survives worker restarts and does not
  need external coordination.

- **Compound and flat rules coexist indefinitely.** Any rule created
  through the UI today is compound; any rule from before the compound
  feature remains flat. Both evaluate through the same code path via
  `normalized_conditions`. Operators never saw a migration window.

- **Rule shape is enforceable at the model level.** `conditions_schema`
  validation branches on `compound?` and walks the condition tree up
  to a depth cap (5) for compound rules. Flat rules use the legacy
  single-condition validator. Same entry point, different walker.

- **Evaluator is shape-agnostic.** `EvaluatorService#matches_rule_at_site?`
  calls `evaluate_group` (recursive over groups) for both shapes.
  Adding a new compound-rule operator (e.g., `NOT`) is a single
  branch addition; the evaluator doesn't have to learn about flat
  rules separately.

## What this is NOT

- **Not a CEP engine.** No windowing semantics beyond `time_window_minutes`.
  No streaming joins, no watermarks, no late-arrival handling. The
  engine evaluates each newly ingested signal against all active rules
  and queries recent signals by time window — that's it. For higher
  complexity (e.g., Flink-class operators), this design does not
  extend cleanly; that would be a different system.

- **Not transactional across rule + task + incident.** The firing
  service's job is the `SignalRuleMatch`. Downstream effects (task
  creation, incident escalation) happen in subsequent jobs /
  transactions. The cooldown claim protects the rule-match creation,
  not the end-to-end fan-out. Each downstream step has its own
  idempotency story (e.g., `RecordNotUnique` rescue on signal ingest).
