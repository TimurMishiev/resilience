---
name: execution_context
description: Durable execution source of truth for direction, roadmap, and engineering expectations
type: project
---

# Resilience — Execution Context

Last updated: 2026-04-22

This file is the durable source of truth for project direction, execution sequencing, collaboration rules, and engineering expectations. It exists so Claude Code or Codex can continue work safely from the repo without relying on chat history.

If this file disagrees with the code, trust the code first and then update this file.

## Current State Snapshot (2026-04-22)

- Phases 1–7 are shipped. Latest roadmap sequencing (including Phase 7 slice list and post-Phase-7 remediation) lives in `memory/execution_handoff.md`.
- Active work: audit-driven remediation. Band A (I1, G1, API1, D1) and Band B (I2, R1) shipped in `27831e1`; handoff rotation committed in `e2d02c2`. Remaining bands (C, D) are tracked in `.claude/skills/resilience-remediation/references/findings.md`.
- Phase definitions below are preserved as the finished roadmap. Do not re-execute them. Any new roadmap phase must be added explicitly, not inferred.

## Project Direction

Resilience is evolving into:

**an operator-grade mission software system for fusing noisy real-time signals, handling degraded environments, supporting replay/debrief, and helping humans understand what happened, what is changing, and what to do next.**

The project should increasingly position its author as:

**a frontend systems engineer who can build serious geospatial, realtime, high-density operator software while preserving backend trust, correctness, and auditability.**

This is not a cinematic military UI project.
This is not a fake autonomy project.
This is not a feature-sprawl project.

It is a serious operational product.

## Core Execution Principles

1. No regressions.
2. Every phase must feel complete if implementation stops there.
3. Do not build speculative abstractions.
4. Preserve existing trust/replay/audit correctness.
5. Frontend is now a major differentiator.
6. Avoid gimmicks:
   - FLIR/NVG shader work
   - cinematic globe effects
   - fake autonomy
   - decorative geospatial work
   - giant state rewrites for their own sake
   - general-purpose workspace builders too early

## Collaboration Model

- Progress must live in the repo, not only in chat.
- `memory/execution_handoff.md` is the active session-to-session handoff file.
- Another model may take over at any moment.
- Only one implementation slice should be treated as actively in progress at a time.
- Every slice must be independently reviewable, independently testable, and safe to stop after.
- At the end of each work session, update `memory/execution_handoff.md`.

## What Good Looks Like

- A slice has a narrow, defensible objective and a clear stop point.
- The product remains coherent if work stops after that slice.
- Replay, trust, audit, and authorization guarantees are preserved.
- Shared state is introduced only when it becomes real and necessary.
- Validation is explicit, repeatable, and recorded in the handoff file.
- Another model can resume from the repo without reconstructing intent from chat.

## Engineering Expectations Per Slice

- Prefer the smallest coherent slice that closes a meaningful unit of work.
- Reuse existing backend signals before adding new APIs.
- Reuse existing frontend patterns before introducing new coordination/state layers.
- Treat trust, freshness, degraded behavior, and replay correctness as product behavior, not polish.
- Add or update tests with every behavior change.
- Record exact validation commands and outcomes in `memory/execution_handoff.md`.
- Do not mix roadmap implementation with speculative future architecture.

## Current Execution Rule

Phases 0–7 are complete. Active work is audit-driven remediation tracked in `memory/execution_handoff.md` and the findings matrix at `.claude/skills/resilience-remediation/references/findings.md`.

Do not start a new roadmap phase without explicit user alignment. Remediation continues in the order Band A → B → C → D.

## Roadmap (shipped; kept for historical reference)

### Phase 0 — Execution Foundation — **shipped**
Goal: repo-based execution continuity and handoff safety.

### Phase 1 — Trustworthy Operational Picture — **shipped**
Goal: make trust, freshness, and degraded-state awareness first-class across the app.

Deliverables:
- source-health model surfaced in UI
- freshness state model defined and reused consistently
- non-spatial trust indicators added
- feed/SSE connection health visible
- degraded-mode banner or ambient trust indicators
- clear distinction between fresh / aging / stale / unavailable

Important boundary:
- this phase owns the freshness/trust model and non-spatial UX
- default assumption: use existing SSE/telemetry freshness and connection signals
- do not introduce a new API unless code reality proves it is necessary
- feed-level operational-health details may remain commander-only for now

Validation:
- [ ] source health is represented in frontend state
- [ ] freshness state type is defined once and reused consistently
- [ ] at least one ambient trust indicator exists outside map/globe
- [ ] SSE/stream degradation is visible to the user
- [ ] stale/unknown states are distinguishable from “no activity”
- [ ] tests cover freshness/degraded-state logic
- [ ] existing tests pass

### Phase 2 — Map Workstation + Triage-in-Context — **shipped**
Goal: make `/map` a serious operator surface.

Deliverables:
- docked/resizable map context panel
- viewport padding respects panel width
- contextual site/entity/alert detail without leaving `/map`
- scoped triage-in-context workflow
- cross-panel coordination
- any new cross-surface state introduced here is formalized cleanly

Important boundary:
- “triage-in-context” means showing recent relevant unacknowledged alerts for the selected context with limited inline actions
- it does NOT mean embedding the full AlertTriagePage into the map
- do not build a general-purpose layout/workspace builder

Validation:
- [ ] map supports docked context panel
- [ ] viewport adjusts when panel opens/closes
- [ ] at least one meaningful investigation flow works without leaving `/map`
- [ ] triage-in-context is scoped and coherent
- [ ] Escape closes docked panel
- [ ] panel can be toggled with keyboard shortcut if appropriate
- [ ] selection sync remains correct
- [ ] existing tests pass

### Phase 3 — Spatial Analytics + Spatial Trust Rendering — **shipped**
Goal: make the map analytical, not just visual.

Deliverables:
- freshness rendered spatially on map
- entity/signal staleness visible spatially
- cross-entity spatial highlighting
- evidence-linked spatial emphasis
- analytical spatial cues for operator reasoning

Important boundary:
- this phase consumes the trust/freshness model from Phase 1
- this phase owns spatial rendering and analytical use of that model

Validation:
- [ ] stale/fresh entities render differently on the map
- [ ] selected context can spatially highlight linked entities
- [ ] evidence-linked highlighting works for at least one major workflow
- [ ] rendering remains legible and not visually noisy
- [ ] tests/manual verification are documented
- [ ] existing tests pass

### Phase 4 — Debrief — **shipped**
Goal: transform replay into a real operational reconstruction workflow.

Deliverables:
- debrief entry flow
- timeline of meaningful operational events
- click-to-reconstruct workflow
- temporal diff between moments
- broader historical reconstruction where currently hidden during replay

Backend prerequisites:
- audit events API supports time-range queries (`from` / `to`)
- audit events API supports cross-entity event queries where needed
- audit events API supports event-type filtering for operationally meaningful events

Important boundary:
- do not build a generic time machine
- keep this focused on operational review and debrief

Validation:
- [ ] debrief entry point exists
- [ ] timeline of meaningful events exists
- [ ] selecting a timeline event reconstructs context at that time
- [ ] at least one temporal diff flow exists
- [ ] any new shared state (debrief range, selected event, etc.) is formalized cleanly
- [ ] replay remains mutation-safe
- [ ] existing tests pass

### Phase 5 — Evidence Threading — **shipped**
Goal: make major operational conclusions explainable and traceable.

Deliverables:
- “show evidence” actions on major objects where appropriate
- provenance badges or equivalent cues
- stale-basis warnings
- map/globe evidence context where appropriate
- shared evidence interface usable across recommendations, alerts, and incidents

Important boundary:
- do not build multiple disconnected evidence UIs
- keep evidence threading operator-oriented and practical

Validation:
- [ ] at least alerts/incidents/recommendations expose evidence access where appropriate
- [ ] stale evidence/basis can be surfaced
- [ ] provenance is visible without deep navigation
- [ ] shared evidence interface exists or is clearly established
- [ ] at least one spatial surface reflects evidence context
- [ ] existing tests pass

### Phase 6 — Performance Characterization — **shipped**
Goal: turn architecture choices into measurable evidence.

Deliverables:
- map benchmark
- globe benchmark characterization strengthened if needed
- documented budgets
- CI assertions for critical thresholds
- measured render/update/interaction timings at realistic densities

Important boundary:
- this phase can be interleaved at any natural break point
- this phase is about characterization and enforcement, not premature micro-optimization

Validation:
- [ ] map benchmark exists
- [ ] at least one budget is documented
- [ ] at least one budget is enforced in CI
- [ ] realistic density scenarios are measured
- [ ] documentation explains limits and expectations

### Phase 7 — Advanced Geospatial Tools — **shipped**
Goal: add a small number of justified operator tools once the core is already strong.

Deliverables:
- measurement tools
- annotation / temporary overlays
- other justified geospatial utilities only if they solve real operator problems

Validation:
- [ ] tool solves a real operator problem
- [ ] tool integrates cleanly with map workflow
- [ ] no major clarity/performance regressions
- [ ] tests/manual verification documented

## Cross-phase Rule

There is NO standalone “shared operational state” phase.

Instead:
Any cross-surface state introduced in Phases 2–5 must be formalized cleanly at the time it is introduced.

Examples:
- selected entity
- replay/debrief selection
- live vs replay mode
- freshness / source health
- evidence context
- cross-panel coordination

Do not create a giant speculative state rewrite.
Do not leave behind duplicated ad hoc coordination if a shared concern becomes real.
