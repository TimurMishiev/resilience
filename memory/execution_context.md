---
name: execution_context
description: Durable execution context — project direction, roadmap, engineering standards, collaboration model
type: project
---

# Resilience — Execution Context

Last updated: 2026-04-10

This file is the durable source of truth for project direction, roadmap sequencing, engineering standards, and collaboration model. It supersedes ad hoc chat context and survives model handoffs.

If this file disagrees with code, prefer code and update this file.

## Project Direction

Resilience is an operator-grade mission software system for fusing noisy real-time signals, handling degraded environments, supporting replay/debrief, and helping humans understand what happened, what is changing, and what to do next.

The project positions its author as a frontend systems engineer who can build serious geospatial, realtime, high-density operator software while preserving backend trust, correctness, and auditability.

This is not a cinematic military UI project, a fake autonomy project, or a feature-sprawl project. It is a serious operational product.

## Core Execution Principles

1. No regressions.
2. Every phase must feel complete if implementation stops there.
3. Do not build speculative abstractions.
4. Preserve existing trust/replay/audit correctness.
5. Frontend is now a major differentiator.
6. Avoid gimmicks: FLIR/NVG shaders, cinematic globe effects, fake autonomy, decorative geospatial work, giant state rewrites for their own sake, general-purpose workspace builders too early.

## Collaboration Model

Claude Code and Codex may work in tandem. That means:

- Progress must live in the repo, not only in chat.
- Handoff continuity is preserved in `memory/execution_handoff.md`.
- Another model may take over at any moment.
- Every slice must be independently reviewable and independently testable.
- `memory/execution_handoff.md` is updated at every session boundary.

## Source of Truth Order

1. Actual code in the repo
2. This file (`memory/execution_context.md`)
3. `memory/execution_handoff.md`
4. `memory/project_roadmap.md`
5. `memory/project_open_findings.md`
6. `memory/project_resilience.md`

## What Good Looks Like

Each slice:
- Ships with tests that cover the new behavior, including edge cases.
- Passes the full existing test suite (2,106 RSpec / 407 Vitest / 0 TS errors).
- Does not introduce N+1 queries, unbounded queries, or memory-unbounded collections.
- Does not break replay correctness or audit integrity.
- Does not introduce security regressions (auth bypass, mass assignment, leaked internals).
- Leaves the codebase in a state where implementation could stop and the product remains coherent.
- Updates `memory/execution_handoff.md` with what was done and what comes next.

## Engineering Expectations Per Slice

- **Backend:** Follow the ServiceResult pattern. Use Pundit for authorization. Use `latest_audit_snapshots` / `snapshot_or_current` for replay. Add request specs for new endpoints. Keep queries bounded.
- **Frontend:** Follow established hook patterns (`useSignals`, `useTasks`, etc.). Use Blueprint.js components. Type everything — no `any` escapes. Use `useReferenceTimeMs` for render-safe time. Add Vitest specs for new components and hooks.
- **Shared:** Keep TypeScript types aligned with actual JSON responses. Keep enum values aligned between Rails constants and TS union types. Nullable fields must be typed `| null`.

---

## Roadmap

### Phase 0 — Execution Foundation

**Goal:** Repo-based execution continuity and handoff safety.

**Deliverables:**
- `memory/execution_context.md` (this file)
- `memory/execution_handoff.md`
- Memory index updated

**Status:** Active.

---

### Phase 1 — Trustworthy Operational Picture

**Goal:** Make trust, freshness, and degraded-state awareness first-class across the app.

**Deliverables:**
- Source-health model surfaced in UI
- Freshness state model defined once and reused consistently
- Non-spatial trust indicators added
- Feed/SSE connection health visible
- Degraded-mode banner or ambient trust indicators
- Clear distinction between fresh / aging / stale / unavailable

**Architecture decision:** Per-source freshness/health model with aggregate rollup. Each data source (SSE event stream, signal stream, telemetry stream, React Query polling) is tracked independently. An aggregate rollup derives overall system freshness from the individual sources. The first implementation slice may start with a narrower subset of sources — the goal of Slice 1 is to establish the shared freshness type, derivation logic, and first aggregate consumer, not the final complete source-health matrix.

**Important boundary:**
- This phase owns the freshness/trust model and non-spatial UX.
- Default assumption: use existing SSE/telemetry freshness and connection signals.
- Do not introduce a new API unless code reality proves it is necessary.
- Feed-level operational-health details may remain commander-only for now.

**Existing assets:** `useEventSource` hook (exposes `ConnectionStatus: 'connecting' | 'connected' | 'disconnected'`), `AppNavbar.tsx` live-indicator dot (line 45, already renders SSE status via CSS class), `useOperationalHealth` hook, `OperationalHealthPage` (commander-only), `dataUpdatedAt` staleness pattern in ~35 files, `useReferenceTimeMs` hook, SSE broadcasters with heartbeat/lease tracking.

**Validation:**
- [ ] Source health is represented in frontend state
- [ ] Freshness state type is defined once and reused consistently
- [ ] At least one ambient trust indicator exists outside map/globe
- [ ] SSE/stream degradation is visible to the user
- [ ] Stale/unknown states are distinguishable from "no activity"
- [ ] Tests cover freshness/degraded-state logic
- [ ] Existing tests pass (2,106 RSpec / 407 Vitest / 0 TS)

---

### Phase 2 — Map Workstation + Triage-in-Context

**Goal:** Make `/map` a serious operator surface.

**Deliverables:**
- Docked/resizable map context panel
- Viewport padding respects panel width
- Contextual site/entity/alert detail without leaving `/map`
- Scoped triage-in-context workflow
- Cross-panel coordination
- Any new cross-surface state introduced here is formalized cleanly

**Important boundary:**
- "Triage-in-context" means showing recent relevant unacknowledged alerts for the selected context with limited inline actions. It does NOT mean embedding the full AlertTriagePage into the map.
- Do not build a general-purpose layout/workspace builder.

**Existing assets:** `MapPage.tsx` (318 lines), `MapSelectionPanels.tsx`, entity selection routing, `useMapLibreEngine` with sub-hooks.

**Validation:**
- [ ] Map supports docked context panel
- [ ] Viewport adjusts when panel opens/closes
- [ ] At least one meaningful investigation flow works without leaving `/map`
- [ ] Triage-in-context is scoped and coherent
- [ ] Escape closes docked panel
- [ ] Panel can be toggled with keyboard shortcut if appropriate
- [ ] Selection sync remains correct
- [ ] Existing tests pass

---

### Phase 3 — Spatial Analytics + Spatial Trust Rendering

**Goal:** Make the map analytical, not just visual.

**Deliverables:**
- Freshness rendered spatially on map
- Entity/signal staleness visible spatially
- Cross-entity spatial highlighting
- Evidence-linked spatial emphasis
- Analytical spatial cues for operator reasoning

**Important boundary:**
- This phase consumes the trust/freshness model from Phase 1.
- This phase owns spatial rendering and analytical use of that model.

**Validation:**
- [ ] Stale/fresh entities render differently on the map
- [ ] Selected context can spatially highlight linked entities
- [ ] Evidence-linked highlighting works for at least one major workflow
- [ ] Rendering remains legible and not visually noisy
- [ ] Tests/manual verification are documented
- [ ] Existing tests pass

---

### Phase 4 — Debrief

**Goal:** Transform replay into a real operational reconstruction workflow.

**Deliverables:**
- Debrief entry flow
- Timeline of meaningful operational events
- Click-to-reconstruct workflow
- Temporal diff between moments
- Broader historical reconstruction where currently hidden during replay

**Backend work (owned by this phase):**
- Audit events API supports time-range queries (`from` / `to`)
- Audit events API supports cross-entity event queries where needed
- Audit events API supports event-type filtering for operationally meaningful events

Phase 4 owns its backend prerequisites. Backend work required for debrief is part of the phase itself, not assumed to exist beforehand.

**Important boundary:**
- Do not build a generic time machine.
- Keep this focused on operational review and debrief.

**Existing assets:** `ReplayContext.tsx`, `replayTransport.ts`, `AuditTimeline.tsx`, `SiteTimeline.tsx`, `SwimlanePage.tsx`, per-entity `as_of` support across all major controllers.

**Validation:**
- [ ] Debrief entry point exists
- [ ] Timeline of meaningful events exists
- [ ] Selecting a timeline event reconstructs context at that time
- [ ] At least one temporal diff flow exists
- [ ] Any new shared state (debrief range, selected event, etc.) is formalized cleanly
- [ ] Replay remains mutation-safe
- [ ] Existing tests pass

---

### Phase 5 — Evidence Threading

**Goal:** Make major operational conclusions explainable and traceable.

**Deliverables:**
- "Show evidence" actions on major objects where appropriate
- Provenance badges or equivalent cues
- Stale-basis warnings
- Map/globe evidence context where appropriate
- Shared evidence interface usable across recommendations, alerts, and incidents

**Important boundary:**
- Do not build multiple disconnected evidence UIs.
- Keep evidence threading operator-oriented and practical.

**Validation:**
- [ ] At least alerts/incidents/recommendations expose evidence access where appropriate
- [ ] Stale evidence/basis can be surfaced
- [ ] Provenance is visible without deep navigation
- [ ] Shared evidence interface exists or is clearly established
- [ ] At least one spatial surface reflects evidence context
- [ ] Existing tests pass

---

### Phase 6 — Performance Characterization

**Goal:** Turn architecture choices into measurable evidence.

**Deliverables:**
- Map benchmark
- Globe benchmark characterization strengthened if needed
- Documented budgets
- CI assertions for critical thresholds
- Measured render/update/interaction timings at realistic densities

**Important boundary:**
- This phase can be interleaved at any natural break point.
- This phase is about characterization and enforcement, not premature micro-optimization.

**Existing assets:** Globe benchmark in Playwright/CI, existing CI pipeline with GitHub Actions.

**Validation:**
- [ ] Map benchmark exists
- [ ] At least one budget is documented
- [ ] At least one budget is enforced in CI
- [ ] Realistic density scenarios are measured
- [ ] Documentation explains limits and expectations

---

### Phase 7 — Advanced Geospatial Tools

**Goal:** Add a small number of justified operator tools once the core is already strong.

**Deliverables:**
- Measurement tools
- Annotation / temporary overlays
- Other justified geospatial utilities only if they solve real operator problems

**Validation:**
- [ ] Tool solves a real operator problem
- [ ] Tool integrates cleanly with map workflow
- [ ] No major clarity/performance regressions
- [ ] Tests/manual verification documented

---

## Cross-Phase Rule

There is NO standalone "shared operational state" phase.

Instead: any cross-surface state introduced in Phases 2-5 must be formalized cleanly at the time it is introduced.

Examples of state that must be formalized when it becomes real:
- Selected entity
- Replay/debrief selection
- Live vs replay mode (already formalized in `ReplayContext`)
- Freshness / source health
- Evidence context
- Cross-panel coordination

Do not create a giant speculative state rewrite.
Do not leave behind duplicated ad hoc coordination if a shared concern becomes real.
