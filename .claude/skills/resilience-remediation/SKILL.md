---
name: resilience-remediation
description: >
  Canonical merged remediation workflow and confirmed findings backlog for Resilience after the multi-audit review.
when_to_use: >
  Use when asked to combine audit findings, prioritize real issues, fix confirmed defects,
  harden the app before new roadmap work, or execute the next validated remediation tranche in Resilience.
---

# Resilience Remediation

This is the shared remediation skill for Resilience.

Its job is:

**Turn confirmed audit findings into a disciplined, regression-safe fix sequence.**

Use this skill when the work is:
- fixing confirmed findings from the merged audits
- prioritizing which confirmed issue should be fixed next
- checking whether a proposed finding is already in the merged backlog
- executing a narrow remediation tranche before new feature work

Do **not** use this skill for:
- full-system review (`audit`)
- pre-commit review (`gate`)
- roadmap-truth review (`wtf-roadmap`)
- speculative new feature planning
- portfolio/CTO strategy by itself

## Source Of Truth

Read:
```
references/findings.md
memory/execution_handoff.md
```

`references/findings.md` is the merged findings matrix.

Treat only the `Confirmed Findings` section there as the executable backlog.

Items listed as rejected, unconfirmed, or strategic are **not** active defects unless re-verified.

## Priority Order

Fix by priority band unless the user explicitly changes the order.

### Band A — Fix Before New Roadmap Work

1. `I1` — correlation evaluator window vs schedule mismatch
2. `G1` — chokepoint truncation on `/map` and `/globe`
3. `API1` — invalid datetime handling in `SignalRuleMatchesController#index`
4. `D1` — `Telemetry::PartitionManager` stale cache after rollback

### Band B — Fix Next For Trust / Historical Correctness

5. `I2` — GPSJam uses wall-clock `occurred_at`
6. `R1` — `Replay::ProjectionService` silently truncates at `100_000` events

### Band C — Required Before Multi-Tenant Shared Deployment

7. `MT1` — telemetry SSE stream is not org-scoped
8. `MT2` — recommendation context assembly does global reads
9. `MT3` — correlation target-site resolution is global when rule AO is nil

### Band D — Lower-Priority Hardening

10. `F1` — `BriefingPanel` stale-response race
11. `O1` — metrics latency window says 5 minutes but behaves like 1 minute
12. `J1` — no `RevokedJwt` pruning job
13. `M1` — migration safety program for production-scale deploys

## Remediation Workflow

### 1. Fix One Coherent Tranche

Unless the user explicitly asks for batching, fix:
- one finding, or
- one tightly coupled pair

Do not silently combine unrelated backlog items into one tranche.

### 2. Re-Read The Finding Before Coding

From `references/findings.md`, extract:
- why the finding is real
- whether it is current or latent
- exact blast-radius files
- minimum required validation

If the finding was marked latent or scale-dependent, do not escalate it into a current-severity defect unless new evidence proves it.

### 3. Read The Whole Blast Radius

Before changing code, read:
- the primary file
- the direct callers
- the direct consumers
- relevant specs/tests
- related policies/services/types if the finding crosses boundaries

### 4. Implement Narrowly

Rules:
- do not widen the slice
- do not pull in adjacent cleanup unless required to make the fix correct
- preserve replay / trust / audit semantics
- preserve auth / org / AO boundaries
- prefer direct fixes over abstraction work

### 5. Validate For Regression Safety

Minimum bar:
- focused spec/test proving the fix
- at least one adjacent regression check on the touched subsystem
- `git diff --check`

Typical additions:
- frontend: focused Vitest + `npx tsc -p tsconfig.app.json --noEmit` + touched-file eslint
- backend: focused RSpec on the changed service/controller/job + one adjacent request/service spec
- map/globe/replay: one targeted UI/engine regression proof if behavior is user-facing

Do not claim a fix is complete if only the direct happy path was tested.

### 6. Keep The Shared Backlog Honest

If a finding is fixed, update:
- `memory/execution_handoff.md`
- this skill's `references/findings.md`

Mirror the same findings-file change into both skill copies so Codex and Claude stay aligned.

## Required Close-Out

At the end of a remediation tranche, report:
- finding ID(s) fixed
- what changed
- what was validated
- whether the shared findings matrix was updated
- whether the handoff was updated
- the next unresolved finding by priority

