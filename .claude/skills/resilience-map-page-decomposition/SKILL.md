---
name: resilience-map-page-decomposition
description: >
  Execute the tests-first decomposition of frontend/src/pages/MapPage.tsx in Resilience,
  with strict scope control, regression-net requirements, and cross-agent handoff discipline.
when_to_use: >
  Use when asked to decompose MapPage.tsx, continue the MapPage decomposition slice,
  or pick up the post-hardening map-page cleanup in Resilience after demo-readiness work.
---

# Resilience MapPage Decomposition

This is the canonical skill for the deferred `MapPage.tsx` decomposition slice.

Use it only for:
- decomposing `frontend/src/pages/MapPage.tsx`
- resuming that decomposition after another model hit limits
- closing the remaining large-file architecture debt on the primary map operator surface

Do not use it for:
- SSE/runtime hardening
- AI restoration
- broad frontend cleanup
- unrelated map/globe feature work

## Core rule

`MapPage.tsx` is the primary operator surface.

Treat this as a high-blast-radius refactor:
- no product-semantic changes
- no speculative state architecture rewrite
- no bundling in adjacent roadmap work
- no decomposition without a direct regression net

## Entry discipline

Before changing code, read:

```text
memory/execution_context.md
memory/execution_handoff.md
frontend/src/pages/MapPage.tsx
frontend/src/test/MapPage.test.tsx
frontend/src/components/map/MapOverlayControls.tsx
```

Then confirm:
- current repo `HEAD`
- whether production is ahead of repo
- whether the worktree is already dirty
- whether any uncommitted demo-readiness tranche must be committed first

If repo truth and production truth are out of sync, reconcile that first.
Do not start the decomposition on top of an ambiguous state.

## Scope target

The objective is not “make the file smaller at any cost.”

The objective is:
- preserve map behavior exactly
- preserve replay parity
- preserve selection/query sync
- preserve inspector/panel routing
- preserve tool-mode orchestration
- preserve layer visibility / map-loaded coordination
- reduce `MapPage.tsx` from a monolith into clearer sub-surfaces with reviewable ownership

## Mandatory tests-first rule

Do not decompose first.

Add or strengthen direct regression coverage for the public behavior of `MapPage` before extraction.

Minimum regression floor:
- selection sync
- route/query sync
- replay gating / replay-safe behavior
- tool-mode orchestration
- inspector / panel routing
- layer visibility / map-loaded coordination where touched

If an existing integration test already proves a branch tightly enough, reuse it.
If a behavior is only indirectly covered, add a direct test.

## Preferred decomposition shape

Decompose by responsibility, not by arbitrary line-count splitting.

Good candidates:
- route / selection synchronization helpers
- replay-aware status / freshness derivations
- inspector / drawer routing logic
- map tool orchestration state
- map surface composition / panel coordination

Avoid:
- extracting tiny wrappers that only move JSX around
- introducing a general-purpose state framework
- adding context/providers unless the slice truly requires them

## Validation requirements

Run the obvious checks for every meaningful sub-slice:

```text
git diff --check
cd frontend && npx tsc --noEmit
cd frontend && npx vitest run <targeted MapPage-related tests>
```

If the slice changes visible map behavior, also run a browser smoke:
- local if available
- production only when explicitly appropriate and safe

Do not claim validation you did not run.

If backend RSpec is still blocked by the PG17/local-schema issue, say so plainly and continue with the relevant frontend proof.

## Handoff discipline

If you hit limits or need to stop mid-slice:
- update `memory/execution_handoff.md`
- record exactly what was extracted
- record what is still in `MapPage.tsx`
- record the next exact file/test to run

Do not leave the next model to reconstruct intent from diffs.

## Stop condition

Stop when one of these is true:
- the current decomposition sub-slice is complete, validated, and handed off cleanly
- you hit a real blocker and recorded it precisely

Do not widen into a second major slice just because momentum is high.
