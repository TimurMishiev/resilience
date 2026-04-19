---
name: execution_handoff
description: Active handoff file for the current phase, slice, validation, and takeover safety
type: project
---

# Resilience — Execution Handoff

Last updated: 2026-04-19

## Current Phase

Phase 6 — Performance Characterization

(Phase 4 — Debrief closed. Phase 5 — Evidence Threading complete. Phase 6 active; Slices 6-1A + 6-1B shipped, 6-1C implemented and validated in-session — pending commit; 6-1D defined.)

## Current Slice

**6-1C — baseline + paint-completion instrumentation + CI gate.** Implemented in-session; product + CI + spec changes uncommitted on the working tree. Ready for `/gate` + commit.

6-1C revised scope (from original plan):
- Added paint-completion measurement via double-rAF in [useMapSignalLayers.ts](frontend/src/hooks/map/useMapSignalLayers.ts): `durationMs` now captures operator-felt time-to-paint; `jsMs` stays in event details as the synchronous-reconcile cost.
- Spec gate switched to asserting on `jsMs` (deterministic, swiftshader-independent); `paintMs` is reported in the summary attachment for observability and local-GPU comparison but not asserted.
- Found + fixed a selection-event loss bug: the effect originally committed `previousSignalCountRef` / `previousSelectedSignalIdRef` synchronously, so a concurrent ref-time or signals update that preempted the double-rAF would swallow the `selection_set` event. Refs now commit only inside the second rAF callback alongside `recordPerfEvent`.
- Maplibre chunk-split removed from [vite.config.ts](frontend/vite.config.ts) — vite 8 / rolldown was re-wrapping the UMD bundle in a way that broke `maplibre_gl_exports` at runtime and prevented `mapLoaded` from ever becoming `true` in the built bundle. Temporary; restore once rolldown has a fix.

## Current Repo State

- Latest shipped slice: `605b963` — Phase 6 Slice 6-1B: Playwright benchmark:map spec + npm script
- Working tree (uncommitted, all 6-1C):
  - [frontend/src/hooks/map/useMapSignalLayers.ts](frontend/src/hooks/map/useMapSignalLayers.ts) — double-rAF paint-completion recording + ref commit inside rAF
  - [frontend/src/test/useMapSignalLayersPerf.test.ts](frontend/src/test/useMapSignalLayersPerf.test.ts) — synchronous rAF mock, `jsMs`-in-details assertions, paint-vs-js separation test, deferred-rAF preemption regression guard for the ref-commit-inside-rAF fix
  - [frontend/e2e/map-benchmark.spec.ts](frontend/e2e/map-benchmark.spec.ts) — asserts on `jsMs`, reports `paintMs`, budgets re-anchored to the 6-1C baseline with 15/30/50ms floors; env overrides renamed `MAP_BENCH_MAX_JS_{MEAN,P95,SINGLE_SAMPLE}_MS`
  - [frontend/vite.config.ts](frontend/vite.config.ts) — maplibre `manualChunks` split removed (rolldown UMD-wrap workaround)
  - [.github/workflows/ci.yml](.github/workflows/ci.yml) — `frontend-perf` job renamed to "Globe + map benchmarks", runs `yarn benchmark:map` after globe, uploads `frontend/test-results/` as `frontend-perf-report` artifact
- For the literal tip SHA, run `git log -1` — it is intentionally not recorded here (self-referential with the commit that writes it).

## Phase 6 — Slice Plan

Sequenced per `Next` below: **6-1A** (instrumentation + bridge, shipped in `19020f3`) → **6-1B** (Playwright spec + `benchmark:map` script, shipped in `605b963`) → **6-1C** (paint-completion instrumentation + baseline + CI gate, implemented in-session, pending commit) → **6-1D** (multi-scale characterization at 1k/10k/100k signals, not started).

## 6-1C Baseline (local, 5 runs × 10 samples, Apple M-series + swiftshader, 315 seeded signals)

- jsMs combined — mean 2.0ms, p95 2.4–2.5ms, max 2.5ms
- paintMs combined — mean 262–410ms, max up to 1444ms (swiftshader software rasterization, not gated)

Budgets (spec defaults, floors in effect — multiplier products are smaller):
- 2.5× mean ≈ 5.0ms → floor 15ms wins
- 2.5× p95 ≈ 6.25ms → floor 30ms wins
- 3× max ≈ 7.5ms → floor 50ms wins

Floors can be lowered once the baseline holds stably across several real CI runs.

## Shipped In This Phase (Phase 6)

- `19020f3` — Phase 6 Slice 6-1A: map signal-reconcile instrumentation + benchmark bridge
- `39008b6` — Phase 6 Slice 6-1A followup: document trigger priority, drop redundant bench field
- `605b963` — Phase 6 Slice 6-1B: Playwright benchmark:map spec + npm script (reshapes bench API to signal-focused)

## Shipped In Phase 5 (closed)

- `e1632fc` — Phase 5 Slice 1: incident alert evidence access
- `024af49` — Phase 5 Slice 2-A-full: recommendation evidence access (labels + alert chain drill-through)
- `9b8614c` — Phase 5 Slice 2-A-followup: apply replay `fired_at <= as_of` filter uniformly to alert evidence labels (closes gate-flagged P3)
- `0ffec30` — Phase 5 Slice 2-B: wire AlertChainDrawer into map alert rows (site + signal panels)
- `1eb1c61` — Phase 5 Slice 2-C: stale-basis surfacing on alert evidence (AlertChainDrawer signal node + map section row tags)

Deferred from Phase 5: **5-2B-globe (optional) — globe alert evidence context**. Would require first adding alert rows to `GlobeInspectorPanel` (not present today — it shows nearest `Signal`s, not alerts). Treat as a separate slice only if an operator use-case warrants it.

## Shipped In Prior Phases (Phase 4 context)

- `2c49a3c` — Phase 4 Slice 1: debrief audit-events API prerequisites
- `afd68b7` — Phase 4 Slice 2: commander-only debrief timeline page
- `45906cb`, `d202532`, `67caf3b`, `70b3de4` — Phase 4 Slice 3: click-to-reconstruct + hardening
- `8ebedf9` — Phase 4 Slices 4a + 4b: temporal diff surfaces + incident A/B compare
- `eec8439` — Phase 4 Slice 4c: site A/B compare
- `7ba0155` — Phase 4 Slice 4c-followup: compare-tab hardening

## In Progress

- **6-1C — paint-completion + baseline + CI gate — implemented in-session, pending commit.** All validation green locally (focused Vitest 6 pass, full Vitest 592 pass, tsc 0 errors, ESLint 0 issues, `git diff --check` clean; 5 local benchmark runs all pass jsMs gate). Known caveat for first CI run: `frontend-perf` now brings up Docker twice through its lifecycle (globe then map), each ~5 local baseline runs shows stable jsMs but paintMs varies widely under swiftshader (not gated).

## Next

- **Commit 6-1C** with a message that names the scope changes (paint-completion measurement, jsMs gate, maplibre chunk-split workaround, CI wiring). Run `/gate` first.
- **6-1D — multi-scale characterization (1k / 10k / 100k signals).** Not started. Current baseline is against the `db:seed`-produced 315-signal dataset. Scale characterization requires a seed-scaling helper (env-flagged, e.g. `BENCHMARK_SIGNAL_COUNT=10000 rails db:seed`) that inflates `vessel_position` / `seismic_event` / etc. without distorting other seeded entities, plus a parameterized variant of `map-benchmark.spec.ts` that records jsMs and paintMs per scale tier. Goal: confirm `useMapSignalLayers` reconcile cost scales sub-linearly through operator-relevant densities and flag the point where paint time crosses operator-felt budgets on real GPU.
- Phase 7 (advanced geospatial tools — measurement, annotation, temporary overlays) remains unstarted and is intentionally sequenced after Phase 6.

## Currently Locked Files

- none

## Validation Commands

```bash
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run src/test/useMapBenchmarkBridge.test.ts src/test/useMapSignalLayersPerf.test.ts
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx tsc -p tsconfig.app.json --noEmit
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx eslint e2e/map-benchmark.spec.ts src/components/map/types.ts src/hooks/useMapBenchmarkBridge.ts src/pages/MapPage.tsx src/test/useMapBenchmarkBridge.test.ts
git -C /Users/timurmishiev/Desktop/Code/resilience diff --check
```

## Last Validation Results (Phase 6 Slice 6-1C, 2026-04-19, pre-commit)

- Focused Vitest (`useMapSignalLayersPerf`): **6 tests, 0 failures** (added preemption regression guard for the ref-commit-inside-rAF fix)
- Full Vitest suite: **592 tests across 82 files, 0 failures**
- TypeScript (`--noEmit`): **0 errors**
- ESLint (touched files): **0 issues**
- `yarn benchmark:map` × 5 local runs against seeded backend + vite preview (127.0.0.1:4178): **all 5 pass**; jsMs combined mean 1.97–2.03ms, p95 2.1–2.5ms, max 2.1–2.5ms — well under the 15/30/50ms gate.
- `git diff --check`: clean

## Known Risks / Blockers

- **Maplibre `manualChunks` split is temporarily disabled in [vite.config.ts](frontend/vite.config.ts).** Under vite 8 / rolldown the UMD wrapper produces `Export 'maplibre_gl_exports' is not defined in module` at runtime, leaving `mapLoaded:false` permanently in the built bundle (including the benchmark build). Re-enable once rolldown fixes the UMD re-wrap; until then maplibre-gl inlines and [vite.config.ts](frontend/vite.config.ts) tracks the issue via the `ON_DEMAND_EXPERIENCE_ASSET_GLOBS` comments.
- **CI `frontend-perf` job now runs two benchmarks (globe + map) against the same Docker app.** First run is likely to expose CI-runner variance in both jsMs and paintMs. If jsMs gate is too tight on GitHub-hosted runners, raise the spec floors (NOT the multiplier) and re-anchor per real CI numbers, or use the env overrides (`MAP_BENCH_MAX_JS_*`). Don't skip the spec on CI pre-emptively — confirm by running.
- **paintMs is reported but not asserted.** Under swiftshader it ranges 100–1444ms across 50 local samples; any operator-felt-time regression detection needs a real-GPU run (local dev, staging, or a future CI runner with GPU pass-through). paintMs numbers in `frontend-perf-report` artifact are for observability only.
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
