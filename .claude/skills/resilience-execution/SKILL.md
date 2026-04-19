---
name: resilience-execution
description: >
  Default implementation workflow for building the active Resilience phase or slice safely.
when_to_use: >
  Use when asked to continue, execute the current slice, implement the next slice,
  pick up where the last model left off, or build roadmap work in Resilience.
---

# Resilience Execution

This is the default implementation-discipline skill for Resilience.

Its job is not to review the system and not to debate the roadmap.
Its job is:

**Execute the active slice safely, tightly, and handoff-cleanly.**

Use this skill for actual implementation work in Resilience.

Do **not** use this skill for:
- pre-commit review (`gate`)
- roadmap truth review (`wtf-roadmap`)
- full-system audit (`audit`)

## Core Operating Standard

Resilience is being built as serious operator-grade mission software.

That means every slice must:
- avoid regressions
- preserve replay / trust / audit integrity
- remain independently reviewable
- remain independently testable
- leave the app in a coherent stopping state
- avoid speculative rewrites

## Phase 1 — Read The Execution Package First

Before changing code, always read:
```
memory/execution_context.md
memory/execution_handoff.md
```

These are the active source of truth.

Use them to extract:
- current phase
- current slice
- objective
- why this slice exists
- files likely to change
- currently locked or risky files
- validation commands
- known risks / blockers
- explicit "Next" item

### Active-slice rule

The handoff file controls the current execution thread.

- If the current slice is still active, execute **that slice only**.
- If the current slice is explicitly marked complete and the handoff names a concrete next slice, that next slice becomes the actionable target.
- If the handoff is stale or contradictory, resolve the contradiction minimally and explicitly. Do not invent a new direction.

## Phase 2 — Confirm Scope Before Coding

Before making code changes, explicitly confirm:
- current phase
- current slice
- likely files to touch
- validation steps
- whether the slice is independently completable

If the slice is **not** independently completable because of a missing prerequisite, say so directly and stop.

If unrelated local changes create ambiguity in the same files you need, stop and ask how to proceed.

## Phase 3 — Slice Discipline

Execute the smallest coherent tranche that closes the current slice.

### Rules

- Do the **current slice only**.
- Do not pull in adjacent roadmap work just because it is nearby.
- Do not do speculative abstraction work.
- Do not do broad refactors for cleanliness alone.
- Do not widen state sharing unless the slice makes that necessary.
- Do not replace working patterns with giant new frameworks or generalized builders.
- Do not silently rewrite product semantics to make implementation easier.

### Acceptable work

- the minimum code needed to complete the slice
- the direct tests needed to prove the touched behavior
- the handoff update needed for continuity
- tightly related validation fixes if they are required to finish the slice safely

## Phase 4 — Resilience-Specific Safety Checks

Apply these checks whenever relevant to the touched surface.

### Replay / Temporal Integrity

If the slice touches replay-aware behavior:
- propagate `as_of` where needed
- use shared reference-time helpers instead of wall-clock time in replay paths
- preserve replay mutation safety
- do not let live data leak into replay semantics

### Trust / Freshness Integrity

If the slice touches trust/freshness:
- preserve stale vs unavailable vs healthy distinctions
- do not silently collapse distinct operator states
- reuse the shared trust/freshness model where it already exists

### Audit / Evidence Integrity

If the slice touches evidence, historical state, or traceability:
- preserve auditability
- preserve explainability
- avoid silent omission of evidence
- avoid pagination or scoping behavior that makes the operator picture incomplete unless the product explicitly says "recent only"

### Map / Globe Integrity

If the slice touches `/map` or `/globe`:
- preserve selection sync
- preserve route sync if the surface uses it
- avoid introducing unnecessary coordination state
- preserve replay parity on geospatial surfaces
- keep trust rendering legible, not noisy
- ensure style switching / map-loaded behavior remains correct where relevant

### AI / Scope Integrity

If the slice touches AI or scoped data:
- preserve auth / tenant / AO / org boundaries
- avoid unscoped data traversal
- verify prompt construction does not widen data exposure

## Phase 5 — Read The Blast Radius

Do not code from the diff hunk alone.

Read:
- every file you will touch
- the direct consumers of the touched code
- the direct providers / dependencies of the touched code
- the relevant tests
- the relevant API/types/policy/service files

If you cannot explain how the touched path works end-to-end, you have not read enough yet.

## Phase 6 — Implement Narrowly

When editing:
- preserve established repo patterns unless they are the direct problem
- keep comments rare and high-signal
- prefer directness over abstraction
- keep naming honest
- leave the slice understandable to the next model

Do not commit or push unless the user explicitly asks.

## Phase 7 — Validate Before Stopping

Run the relevant validation from the handoff plus the obvious checks for the touched surface.

Typical examples:
- focused Vitest / RSpec files
- `npx tsc --noEmit` for frontend changes
- targeted eslint on touched frontend files
- `git diff --check`
- focused manual verification for map/globe/replay surfaces if the slice warrants it

Do not claim validation you did not run.

If validation cannot run because of environment drift, say so clearly.

## Phase 8 — Update Handoff Before Stopping

Before finishing, update:
```
memory/execution_handoff.md
```

It must reflect reality:
- current phase
- current slice
- what changed this session
- in progress
- next
- files likely to change
- locked/risky files
- validation commands
- last validation results
- known risks / blockers
- open questions
- do not reopen

The handoff file is for takeover continuity, not a diary.
Keep it concise and factual.

## Required Final Close-Out

At the end, report:
- what changed
- what was validated
- whether the handoff was updated
- locked or risky files
- the next logical step

## Stop Conditions

Stop when all of these are true:
- the current slice is complete or you hit a real blocker
- the app is left in a coherent working state
- relevant validation has run
- `memory/execution_handoff.md` is updated

If those are not true, you are not done.

## Relationship To Other Skills

- Use `gate` after implementation when you need commit-readiness review.
- Use `wtf-roadmap` when you need milestone / roadmap truth.
- Use `audit` when you need whole-system forensic review.

This skill is the **builder**.
