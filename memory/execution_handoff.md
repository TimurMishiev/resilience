---
name: execution_handoff
description: Active handoff file for the current phase, slice, validation, and takeover safety
type: project
---

# Resilience — Execution Handoff

Last updated: 2026-04-19

## Current Phase

Phase 5 — Evidence Threading

(Phase 4 — Debrief closed. Phase 5 — Evidence Threading **complete**. Slices shipped: Slice 1 (`e1632fc`), Slice 2-A-full (`024af49`), Slice 2-A-followup (`9b8614c`), Slice 2-B (`0ffec30`), Slice 2-C (`1eb1c61`).)

## Current Slice

**None active — Phase 5 closed.** Validation checklist is 5-of-5 complete as of 2026-04-19 (`1eb1c61`). Next phase is Phase 6 — Performance Characterization. See `memory/execution_context.md` for the canonical Phase 6 scope.

Scope note for completed 5-2B: `/globe` was intentionally excluded. `GlobeInspectorPanel` does not render `SignalRuleMatch` rows today (it shows nearest `Signal`s, not alerts). Adding alert rows to the globe is a separate slice, not part of 5-2B.

## Current Repo State

- Latest shipped slice: `1eb1c61` — Phase 5 Slice 2-C: stale-basis surfacing on alert evidence
- Working tree: clean
- For the literal tip SHA, run `git log -1` — it is intentionally not recorded here (self-referential with the commit that writes it).

## Phase 5 — Closed

Slice 1 delivered incident → alert threading. Slice 2-A-full delivered rec → evidence-label + rec → alert-chain threading. Slice 2-B delivered map alert-row → alert-chain. Slice 2-C delivered stale-basis surfacing. All five Phase 5 validation items are now met.

Deferred: **5-2B-globe (optional) — globe alert evidence context**. Would require first adding alert rows to `GlobeInspectorPanel` (not present today — it shows nearest `Signal`s, not alerts). Not a natural Phase 5 increment; treat as a separate slice only if an operator use-case warrants it.

## Shipped In This Phase

- `e1632fc` — Phase 5 Slice 1: incident alert evidence access
- `024af49` — Phase 5 Slice 2-A-full: recommendation evidence access (labels + alert chain drill-through)
- `9b8614c` — Phase 5 Slice 2-A-followup: apply replay `fired_at <= as_of` filter uniformly to alert evidence labels (closes gate-flagged P3)
- `0ffec30` — Phase 5 Slice 2-B: wire AlertChainDrawer into map alert rows (site + signal panels)
- `1eb1c61` — Phase 5 Slice 2-C: stale-basis surfacing on alert evidence (AlertChainDrawer signal node + map section row tags)

## Shipped In Prior Phases (Phase 4 context)

- `2c49a3c` — Phase 4 Slice 1: debrief audit-events API prerequisites
- `afd68b7` — Phase 4 Slice 2: commander-only debrief timeline page
- `45906cb`, `d202532`, `67caf3b`, `70b3de4` — Phase 4 Slice 3: click-to-reconstruct + hardening
- `8ebedf9` — Phase 4 Slices 4a + 4b: temporal diff surfaces + incident A/B compare
- `eec8439` — Phase 4 Slice 4c: site A/B compare
- `7ba0155` — Phase 4 Slice 4c-followup: compare-tab hardening

## In Progress

- None. Awaiting direction for next slice.

## Next

- **Phase 6 — Performance Characterization.** Phase 5 is closed; Phase 6 is the natural next target.
  - **Known gap 1 — `yarn benchmark:map` script + spec do not exist yet.** `benchmark:globe` already exists; the map equivalent has not been written. Scope: a repeatable headless render/pan/zoom benchmark for the `/map` surface capturing FPS + interaction latency on a representative dataset.
  - **Known gap 2 — documented budgets.** Phase 6 requires explicit latency/FPS budgets for map and globe, committed to the repo so regressions are observable.
  - **Known gap 3 — CI threshold assertions.** Once budgets exist, CI should fail when a benchmark regresses past the threshold. Until then the benchmarks are informational only.
  - **Sequencing:** start with the benchmark script (no budget needed to run it), use first runs to establish a realistic baseline, then commit budgets, then wire CI assertion last. Do not short-circuit by guessing numbers.
- Phase 7 (advanced geospatial tools — measurement, annotation, temporary overlays) remains unstarted and is intentionally sequenced after Phase 6.

## Currently Locked Files

- none

## Validation Commands

```bash
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run src/test/AlertChainDrawer.test.tsx src/test/MapSiteAlertsSection.test.tsx src/test/MapSignalAlertsSection.test.tsx
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx tsc -p tsconfig.app.json --noEmit
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx eslint src/components/AlertChainDrawer.tsx src/components/MapSiteAlertsSection.tsx src/components/MapSignalAlertsSection.tsx src/test/AlertChainDrawer.test.tsx src/test/MapSiteAlertsSection.test.tsx src/test/MapSignalAlertsSection.test.tsx
git -C /Users/timurmishiev/Desktop/Code/resilience diff --check
```

## Last Validation Results (Phase 5 Slice 2-C, 2026-04-19, pre-commit)

- Focused Vitest (`AlertChainDrawer` + `MapSiteAlertsSection` + `MapSignalAlertsSection`): **39 examples, 0 failures** (+12 new for 5-2C)
- Full Vitest suite: **576 tests across 80 files, 0 failures** (was 564/79 on 5-2B)
- TypeScript (`tsconfig.app.json`): **0 errors**
- ESLint on touched files: **0 issues**
- `git diff --check`: **clean**

## Known Risks / Blockers

- Backend local validation still needs the repo Ruby path:
  - `TEST_DATABASE_PORT=5434 /Users/timurmishiev/.rbenv/shims/bundle exec ...`
  - the system `bundle` path still fails on the known Bundler `2.7.2` mismatch
- Frontend type-check must continue using:
  - `npx tsc -p tsconfig.app.json --noEmit`
  - the loose root `tsc --noEmit` is not authoritative for this repo
- **`AlertChainDrawer` mount convention on `/map`.** Each of `MapSignalAlertsSection` and `MapSiteAlertsSection` mounts its own `AlertChainDrawer` instance with local state. Safe today because `MapSignalPanel` and `MapSitePanel` are mutually exclusive in `MapSelectionPanels` — only one is rendered at any time, so only one drawer exists in the tree. If a future slice mounts both panels simultaneously, or mounts `EvidenceDrawer` on `/map` (which itself nests an `AlertChainDrawer`), reconcile to a single coordinator at `MapPage` or `MapSelectionPanels` level. Same reconciliation note as 5-2A.
- Both sections already null-render during replay (`if (isReplaying) return null`). The Chain button therefore never appears in replay, which matches `AlertChainDrawer`'s existing design (never opened from a replay context). If a future surface renders alert rows during replay, the chain drawer's replay semantics need to be re-evaluated.
- **`AlertChainDrawer.referenceTimeMs` is opt-in.** Callers without a replay-aware clock (e.g. `AlertTriagePage`, `IncidentAlertsTab`, `SiteDetailPage`, `AlertsPanel`, `EvidenceDrawer`) intentionally omit the prop and get no stale-basis indicator. This is correct — the drawer must never wall-clock (`react-hooks/purity` forbids `Date.now()` in the component body, and replay correctness forbids it anyway). If a future surface wants the indicator, it must thread a real reference clock through.
- Evidence resolution is scoped to the `/api/recommendations` surface only. It does **not** widen any other API that happens to render raw `evidence` JSONB.
- Replay intentionally returns both `alert: null` and `label: null` for matches whose `fired_at > as_of`. Do not "helpfully" fall back to live state — that would leak future state into replay.
- Handoff never records the tip SHA — it would be self-referential with the commit that writes it. Product-commit SHAs live in "Shipped In This Phase"; run `git log -1` for the literal tip.

## Do Not Reopen

- Phase 0 — Execution Foundation
- Phase 1 — Trustworthy Operational Picture
- Phase 2 — Map workstation + triage-in-context
- Phase 3 — Spatial analytics + spatial trust rendering
- Phase 4 Slice 1 — debrief audit-events API prerequisites
- Phase 4 Slice 2 — debrief entry + meaningful-event timeline
- Phase 4 Slice 3 — click-to-reconstruct workflow
- Phase 4 Slices 4a + 4b — temporal diff + incident compare
- Phase 4 Slice 4c — site compare
- Phase 4 Slice 4c-followup — compare-tab hardening
- Phase 5 Slice 1 — incident alert evidence access
- Phase 5 Slice 2-A-full — recommendation evidence access
- Phase 5 Slice 2-A-followup — replay fired_at filter on alert evidence labels
- Phase 5 Slice 2-B — map alert evidence chain affordance
- Phase 5 Slice 2-C — stale-basis surfacing on alert evidence
- project-skill consolidation / deep-review removal / repo-managed `.claude/skills`
