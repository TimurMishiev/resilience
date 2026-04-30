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
cd frontend && npx tsc -b
cd frontend && npx vitest run <targeted MapPage-related tests>
```

If the slice changes visible map behavior, also run a browser smoke:
- local if available
- production only when explicitly appropriate and safe

Do not claim validation you did not run.

If backend RSpec is still blocked by the PG17/local-schema issue, say so plainly and continue with the relevant frontend proof.

## Review loop

Do not use the whole-system `audit` skill after every tiny extraction.
That is too blunt, too slow, and too noisy for an in-flight page refactor.

Use this loop instead:

### Per sub-slice (mandatory)
After every coherent extraction or behavior-preserving refactor step:

1. run:
   - `git diff --check`
   - `cd frontend && npx tsc -b`
   - `cd frontend && npx vitest run <targeted MapPage-related tests>`
2. if any check fails, fix it immediately before touching the next slice
3. do not stack a second unvalidated extraction on top of a failing first one

### Per coherent tranche (mandatory)
After 1–3 related sub-slices, or before any commit:

1. run the `gate` skill against the current dirty tree
2. resolve any P0/P1 before continuing
3. resolve P2/P3 immediately if they are in-slice and cheap; otherwise record them explicitly in `memory/execution_handoff.md`
4. only continue to the next tranche once gate says the current tranche is coherent

### Milestone boundaries (selective)
Use the whole-system `audit` skill only when one of these is true:

- a major `MapPage` milestone landed
- the refactor changed visible map behavior beyond the direct page seam
- the work is about to be deployed
- the whole app is about to be sent externally

Default milestone examples:
- regression-net complete
- first major decomposition tranche complete
- final `MapPage` tranche complete
- pre-deploy / pre-outreach

### Escalation rule

If `gate` surfaces a likely cross-surface issue that `MapPage` tests do not prove,
then pause the next extraction and escalate to `audit`.

### Working rule

The safe cadence is:

`build slice -> validate -> gate -> fix findings -> continue`

not

`build slice -> audit whole app -> build slice -> audit whole app`

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
