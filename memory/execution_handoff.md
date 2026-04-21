---
name: execution_handoff
description: Active handoff file for the current phase, slice, validation, and takeover safety
type: project
---

# Resilience — Execution Handoff

Last updated: 2026-04-20

## Current Phase

Phase 7 — Advanced Geospatial Tools

(Phase 4 — Debrief closed. Phase 5 — Evidence Threading complete. Phase 6 Slice 6-1 fully shipped and closed in `aa07c91`. Phase 7 Slice 7-1A shipped in `4ea3def`, and Phase 7 Slice 7-1A-followup shipped in `37f7a40`; the current dirty tree is the next map-only tool slice.)

## Current Slice

**Phase 7 Slice 7-1B — temporary map annotations (UNCOMMITTED).**

Objective: add a second small operator-grade `/map` tool after measurement: session-local temporary pins with editable labels, no persistence, no route state, and no globe parity.

Current implementation state:
- `/map` now has an explicit annotation mode separate from measurement mode
- while annotation mode is active, map clicks drop session-local pins instead of changing selection
- temporary pins render as labeled map overlays through a dedicated annotation layer hook
- the overlay controls expose rename / remove / clear-all management for the current client session only
- adapter coverage now proves annotation layers are added after the signal stack, mirroring the measurement paint-order guard
- page-level tests now prove annotation / measurement mode mutual exclusivity and the `Clear all` counter reset path

Boundaries held:
- no backend changes
- no replay/trust/audit contract changes
- no persistence, URL state, or collaboration semantics
- no globe work

## Current Repo State

- Latest committed product slice: `37f7a40` — Phase 7 Slice 7-1A-followup: measurement overlay paint-order hardening
- Current tip commit: `37f7a40`
- Working tree: dirty on the active 7-1B tranche plus this handoff update
- Branch state: `main` even with `origin/main`
- Dirty/tranche files right now:
  - `frontend/src/components/map/MapOverlayControls.tsx`
  - `frontend/src/hooks/useMapLibreEngine.ts`
  - `frontend/src/hooks/map/useMapAnnotationLayers.ts`
  - `frontend/src/index.css`
  - `frontend/src/lib/mapAnnotations.ts`
  - `frontend/src/pages/MapPage.tsx`
  - `frontend/src/test/MapPage.test.tsx`
  - `frontend/src/test/useMapLibreEngine.test.ts`
  - `memory/execution_handoff.md`

## Phase 7 — Slice Plan

Sequenced:
- **7-1A** — `/map` measurement tool (**shipped** in `4ea3def`)
- **7-1A-followup** — measurement overlay paint-order hardening (**shipped** in `37f7a40`)
- **7-1B** — temporary map annotations (**current uncommitted tranche**)
- **7-1C** — other justified geospatial utilities only if they solve a real operator problem and are explicitly scoped

## Shipped In This Phase (Phase 7)

- `4ea3def` — Phase 7 Slice 7-1A: `/map` measurement tool (session-local distance/bearing, no backend persistence, no globe parity)
- `37f7a40` — Phase 7 Slice 7-1A-followup: measurement overlay paint-order hardening (measurement geometry paints above dense signal layers; direct adapter proof added)

## Phase 6 — Closed Slice Plan (historical context)

Sequenced: **6-1A** (instrumentation + bridge, shipped in `19020f3`) → **6-1B** (Playwright spec + `benchmark:map` script, shipped in `605b963`) → **6-1C** (paint-completion instrumentation + baseline + CI gate, shipped in `6bcaa2d` + `465c4f9`) → **6-1D** (multi-scale characterization at 1k/10k/100k signals via synthetic-signal override, shipped in `1527052`) → **6-1E.a** (multi-run baseline, shipped in `5fb620b`) → **6-1E.b** (CI wiring + per-tier gates from 6-1E.a evidence, shipped in `aa07c91`). Phase 6 Slice 6-1 is closed.

## 6-1C Baseline (local, 5 runs × 10 samples, Apple M-series + swiftshader, 315 seeded signals)

- jsMs combined — mean 2.0ms, p95 2.4–2.5ms, max 2.5ms
- paintMs combined — mean 262–410ms, max up to 1444ms (swiftshader software rasterization, not gated)

Budgets (spec defaults, floors in effect — multiplier products are smaller):
- 2.5× mean ≈ 5.0ms → floor 15ms wins
- 2.5× p95 ≈ 6.25ms → floor 30ms wins
- 3× max ≈ 7.5ms → floor 50ms wins

Floors can be lowered once the baseline holds stably across several real CI runs.

## 6-1D Baseline (local, 1 run × 5 cycles × 2 triggers = 10 samples per tier, Apple M-series + swiftshader, synthetic signals)

| Tier  | jsMs mean | jsMs p95 | jsMs max | paintMs mean | paintMs max |
|-------|----------:|---------:|---------:|-------------:|------------:|
| 1k    | 6.02      | 10.0     | 10.0     | 321.8        | 1189.1      |
| 10k   | 49.02     | 57.1     | 57.1     | 301.4        | 790.4       |
| 100k  | 189.5     | 1057.2   | 1057.2   | 632.5        | 1788.6      |

- **1k → 10k**: jsMs mean 8.1× for 10× data — near-linear.
- **10k → 100k**: jsMs mean 3.86× for 10× data — strongly sublinear (indexed Map ops paying off).
- **100k has a single 1057ms outlier.** Range min 26.7ms → max 1057ms over 10 samples. Most samples are sub-200ms; one worst-case sample crossed the 1s operator-felt threshold. Likely GC pause or browser contention. Treat as known worst case, not a steady-state failure — would need ≥5 runs to characterize tail shape properly.
- paintMs is noisy under swiftshader (100k hit 1.79s max); keep reporting, don't gate. Real-GPU baselines would be needed before any paintMs gate.
- 6-1C seeded-pipeline baseline (315 signals, mean 2.0ms) sits squarely on the 1k synthetic curve — synthetic path is not artificially fast.
- CI wiring for `benchmark:map:scale` is intentionally **not yet added**. See 6-1E in `Next`.

## 6-1E.a Baseline (local, 5 runs × 5 cycles × 2 triggers = 50 samples per tier per metric, Apple M-series + swiftshader, synthetic signals)

Per-tier aggregated jsMs (combined selection_set + selection_cleared):

| Tier  | mean-of-means | mean spread (across 5 runs) | per-run p95 spread | global max | gateable? |
|-------|--------------:|----------------------------:|-------------------:|-----------:|----------|
| 1k    | 6.08          | 5.89 – 6.57                 | 9.4 – 12.2         | 12.20      | yes (mean / p95 / max all stable) |
| 10k   | 40.76         | 8.46 – 49.17                | 56.8 – 58.6        | 58.60      | p95 only (mean has a single 8.46 outlier; p95 spread is 1.6%) |
| 100k  | 81.57         | 29.04 – 140.49              | 32.6 – 646.7       | 646.70     | no — keep report-only |

paintMs aggregated (swiftshader noise — for observability only, not gate-eligible at any tier):

| Tier  | mean-of-means | per-run p95 spread     | global max |
|-------|--------------:|-----------------------:|-----------:|
| 1k    | 412.25        | 524.9 – 2306.9         | 2306.90    |
| 10k   | 365.73        | 617.6 – 1642.3         | 1642.30    |
| 100k  | 621.05        | 1225.8 – 2215.9        | 2215.90    |

Per-run jsMs.combined (mean / p95 / max), 5 runs, in chronological order:

- **1k**:   (6.12 / 9.40 / 9.40), (5.90 / 9.90 / 9.90), (6.57 / 12.20 / 12.20), (5.89 / 9.80 / 9.80), (5.90 / 9.90 / 9.90)
- **10k**:  (48.93 / 57.50 / 57.50), (48.74 / 58.60 / 58.60), (48.51 / 56.80 / 56.80), (8.46 / 57.40 / 57.40), (49.17 / 56.80 / 56.80)
- **100k**: (60.18 / 326.00 / 326.00), (140.49 / 597.60 / 597.60), (120.90 / 646.70 / 646.70), (29.04 / 32.60 / 32.60), (57.25 / 311.90 / 311.90)

Findings:

- **6-1D's 1057ms 100k outlier is now positioned in context.** Run 2/3 of this characterization hit 597 / 646 ms p95; run 4 was clean at 32.6ms p95; run 1 was 326ms. The 1057ms tail isn't a freak — it's part of a real bimodal-looking distribution at 100k. Need raw per-sample arrays to distinguish "long tail" from "occasional GC pause" — current spec only attaches summaries.
- **10k mean is volatile, p95 is rock-solid.** The 8.46ms run-mean (run 4) is a real anomaly: every other run sits at 48.5–49.2ms. Likely cause: per-spec each tier runs 5 selection_set + 5 selection_cleared cycles. The `min` field in every 10k run is 2.5–3.0ms (one trigger consistently fast — likely `selection_cleared` paint coalescing). When 4 of those fast samples land in a single mean computation, the mean drops. Spec aggregates `combined` over both triggers, masking this. Future-proofing: report `selection_set` and `selection_cleared` separately in the gate decision (the spec already records both, just doesn't gate on them).
- **paintMs is wildly noisy.** 1k tier paintMs p95 (524–2306ms) often exceeds the 100k tier paintMs p95 — this is swiftshader software-rasterizer behavior, not signal density. Confirms 6-1D conclusion: never gate paintMs without real-GPU hardware.
- All 5 `yarn benchmark:map:scale` runs passed (35.2 / 29.1 / 30.1 / 25.9 / 29.3 s; total 2m 30s including overhead). No env tuning, no test edits.

## Shipped In Phase 6 (historical context)

- `19020f3` — Phase 6 Slice 6-1A: map signal-reconcile instrumentation + benchmark bridge
- `39008b6` — Phase 6 Slice 6-1A followup: document trigger priority, drop redundant bench field
- `605b963` — Phase 6 Slice 6-1B: Playwright benchmark:map spec + npm script (reshapes bench API to signal-focused)
- `6bcaa2d` — Phase 6 Slice 6-1C: paint-completion measurement + jsMs CI gate (double-rAF in `useMapSignalLayers`, refs commit inside rAF, spec asserts on `jsMs`, `benchmark:map` wired into `frontend-perf` CI job, maplibre `manualChunks` removed as rolldown UMD-wrap workaround)
- `465c4f9` — Phase 6 Slice 6-1C followup: vite maplibre comment + test whitespace P3 cleanup
- `1527052` — Phase 6 Slice 6-1D: multi-scale characterization (1k / 10k / 100k synthetic signals via `localStorage.resilience.perf.bench_signal_count` override; new `buildSyntheticBenchSignals` + `benchmark:map:scale` Playwright spec; one Playwright test per tier; per-tier JSON report attached, no CI gates)
- `cea12a5` — Handoff bump: mark 6-1D shipped and 6-1E next (doc-only)
- `5fb620b` — Phase 6 Slice 6-1E.a: 100k tail characterization (5 runs × 50 samples per tier baseline + per-tier gating decision tree, doc-only)
- `aa07c91` — Phase 6 Slice 6-1E.b: per-tier gates in `map-scale-benchmark.spec.ts` (1k: jsMs mean ≤ 15 / p95 ≤ 25 / max ≤ 30; 10k: p95 ≤ 120 / max ≤ 150; 100k: report-only) + `benchmark:map:scale` step in `frontend-perf` CI job; env overrides per-tier per-metric (`MAP_SCALE_BENCH_{1K,10K,100K}_MAX_JS_{MEAN,P95,MAX}_MS`); custom tiers via `MAP_SCALE_BENCH_TIERS` are documented as report-only unless their per-tier envars are also set

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

- **Phase 7 Slice 7-1B — temporary map annotations**
  - annotation mode now owns map clicks separately from measurement mode
  - session-local pins render as labeled overlays and stay client-local
  - overlay controls support rename / remove / clear-all without adding route state
  - tests now pin paint-order visibility and mode exclusivity directly
  - focused + full frontend validation is green
  - next immediate step is `gate`, then commit if review stays clean

## Next

- **Immediate next step:** run `gate` on the 7-1B temporary-annotations tranche, then commit if the slice stays clean.
- **After 7-1B ships, recommended next slice:** **7-1C — other justified geospatial utilities only if they solve a real operator problem and are explicitly scoped.**
- **Explicit boundary for post-7-1B work:** do not jump straight to persistence, collaboration, or a generalized geospatial workspace. Keep Phase 7 additive and tool-specific.
- **Watch the first real `frontend-perf` CI run on `aa07c91` (or its first PR descendant).** Watch points:
    - 1k tier: budgets are 15/25/30ms; current local p95-of-p95s is 10.2ms. Headroom is ~2×. CI runner variance may eat into that.
    - 10k tier: p95 budget is 120ms; current p95-of-p95s is 57.4ms. Headroom is ~2.1× (raised from 80ms after gate flagged that ~1.4× was tight for ubuntu-latest). Should hold first time; re-anchor via env if real CI numbers prove otherwise.
    - 100k tier: ungated; per-tier JSON attaches to `frontend-perf-report` artifact for observability.
    - If any tier flakes, raise the floor in `DEFAULT_BUDGETS` or set a per-env override (`MAP_SCALE_BENCH_{TIER}_MAX_JS_{METRIC}_MS`). Do **NOT** widen the budget multiplier-style — re-anchor to the actual CI numbers.
- **Watch-item (not yet a slice):** if the first real CI run shows wall-time pressure from running globe + map + map-scale sequentially against the same Docker bring-up, split `frontend-perf` into a job matrix. Don't pre-emptively split — wait for actual numbers.
- **Followup consideration (do NOT pre-emptively land):** the spec attaches per-tier *summaries* but not raw per-sample arrays. If 100k tail behavior ever needs deeper diagnosis (bimodal? GC-pause? cycle-position?), extend the report shape to include `jsMs.{trigger}.samples: number[]`. Not needed for current CI gating.
- **Followup consideration (do NOT pre-emptively land):** `combined.p95` aggregates two structurally different distributions (`selection_set` reconcile cost + `selection_cleared` paint-coalesced near-zero). Per-trigger gating (`selectionSet.p95`, `selectionCleared.p95`) would be more honest. Defer until a real regression investigation needs the cleaner signal.

## Currently Locked Files

- none

## Validation Commands

```bash
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx tsc -p tsconfig.app.json --noEmit
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run src/test/MapPage.test.tsx src/test/useMapLibreEngine.test.ts
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx eslint src/pages/MapPage.tsx src/components/map/MapOverlayControls.tsx src/hooks/useMapLibreEngine.ts src/hooks/map/useMapAnnotationLayers.ts src/lib/mapAnnotations.ts src/test/MapPage.test.tsx src/test/useMapLibreEngine.test.ts
git -C /Users/timurmishiev/Desktop/Code/resilience diff --check
```

## Last Validation Results (Phase 7 Slice 7-1B, uncommitted, 2026-04-20)

- Focused annotation validation:
  - `npx vitest run src/test/MapPage.test.tsx src/test/useMapLibreEngine.test.ts` → **72 / 72 pass**
- Full frontend validation:
  - `npx vitest run` → **613 / 613 pass across 84 files**
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - touched-file ESLint on 7-1B files → **0 issues**
  - `git diff --check` → **clean**
- No backend validation was required for this slice because the tranche is frontend-only and introduces no API/schema/runtime-backend changes.

### Most recent committed product validation (Phase 7 Slice 7-1A-followup, shipped in `37f7a40`, 2026-04-20)

- Focused follow-up validation:
  - `npx vitest run src/test/useMapLibreEngine.test.ts src/test/MapPage.test.tsx` → **66 / 66 pass**
- Full frontend validation:
  - `npx vitest run` → **609 / 609 pass across 84 files**
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - touched-file ESLint on follow-up files → **0 issues**
  - `git diff --check` → **clean**
- No backend validation was required for this slice because the tranche is frontend-only and introduces no API/schema/runtime-backend changes.

### Prior committed product validation (Phase 7 Slice 7-1A, shipped in `4ea3def`, 2026-04-20)

- Focused measurement validation:
  - `npx vitest run src/test/mapMeasurement.test.ts src/test/MapPage.test.tsx src/test/useMapLibreEngine.test.ts` → **68 / 68 pass**
- Full frontend validation:
  - `npx vitest run` → **608 / 608 pass across 84 files**
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - touched-file ESLint on measurement slice files → **0 issues**
  - `git diff --check` → **clean**
- No backend validation was required for this slice because the tranche is frontend-only and introduces no API/schema/runtime-backend changes.

### Prior committed product validation (Phase 6 Slice 6-1E.b, shipped in `aa07c91`, 2026-04-19)

- Pre-commit local validation:
    - TypeScript (`npx tsc -p tsconfig.app.json --noEmit`): **0 errors**
    - ESLint on touched spec (`npx eslint e2e/map-scale-benchmark.spec.ts`): **0 issues**
    - Vitest full suite: **600 / 600 pass across 83 files** in 23.4s
    - Whitespace check (`git diff --check`): **clean**
    - `yarn benchmark:map:scale` × 1 (gates active): **all 3 tiers pass in 54.8s**
        - 1k tier: jsMs mean 6.46 ≤ 15 ✓, p95 10.1 ≤ 25 ✓, max 10.1 ≤ 30 ✓
        - 10k tier: jsMs p95 59.8 ≤ 120 ✓, max 59.8 ≤ 150 ✓ (mean ungated by design)
        - 100k tier: report-only (no expects fired); jsMs mean 27.8 / p95 34.1 / max 34.1
- Post-push gate suite on `aa07c91`: **all green** — RSpec ✓ / TypeScript ✓ / ESLint ✓ / Brakeman (0 warnings, 0 errors) ✓ / bundler-audit (0 vulns) ✓ / frontend build (MapPage chunk 72.42 kB, maplibre-gl auto-chunked at 1024 kB / 272 kB gzip) ✓
- First real `frontend-perf` CI run (which exercises the new gates against ubuntu-latest swiftshader) has not yet been observed. Watch per the `Next` section.

### Preceding validation (Phase 6 Slice 6-1E.a, shipped in `5fb620b`, 2026-04-19)

- 5× sequential `yarn benchmark:map:scale` invocations: **all 5 runs pass** (35.2 / 29.1 / 30.1 / 25.9 / 29.3 s; total 2m 30s including overhead). 15 per-tier JSON reports captured in `/tmp/resilience-bench-6-1E/reports.ndjson`; aggregated stats recorded in `6-1E.a Baseline` above.
- No code changed; no new tests; no gate runs (vitest / tsc / eslint not relevant to a doc-only handoff bump).
- Local services used: vite preview at 127.0.0.1:4178, backend at 127.0.0.1:3000, swiftshader chromium per existing `playwright.config.ts`.

### Preceding validation (Phase 6 Slice 6-1D, shipped in `1527052`, 2026-04-19)

- Full Vitest suite: **600 tests across 83 files, 0 failures** (8 new `benchSyntheticSignals` tests: determinism, Signal shape, bounding box, count floor, localStorage parse edges)
- TypeScript (`npx tsc -p tsconfig.app.json --noEmit`): **0 errors**
- ESLint on touched files (benchSyntheticSignals.ts, benchSyntheticSignals.test.ts, MapPage.tsx, map-scale-benchmark.spec.ts): **0 issues**
- Frontend build (`yarn build`): **success**; MapPage chunk unchanged (72.42 kB), maplibre-gl still auto-chunked at 1024 kB (272 kB gzip)
- Per-tier `yarn benchmark:map:scale` (one local run, 5 cycles × 2 triggers per tier): **all 3 tiers pass in 33.2s total**; jsMs mean 6.02 / 49.02 / 189.5 ms (1k / 10k / 100k). Full table recorded in `6-1D Baseline` above.

### Preceding validation (Phase 6 Slice 6-1C + followup, shipped)

- Post-push automated gate suite (after `465c4f9`): **all green** — RSpec, TypeScript, ESLint, Brakeman (0 warnings, 0 errors), bundler-audit, frontend build.
- `yarn benchmark:map` × 5 local runs against seeded backend + vite preview (127.0.0.1:4178): **all 5 pass**; jsMs combined mean 1.97–2.03ms, p95 2.1–2.5ms, max 2.1–2.5ms — well under the 15/30/50ms gate.

## Known Risks / Blockers

- **Phase 7 Slice 7-1B is intentionally `/map`-only and session-local.** There is no persistence, no URL state, no globe parity, and no collaboration semantics. Do not accidentally treat the current pin model as the foundation for collaborative overlays or saved annotation layers.
- **Annotation mode intentionally owns map clicks.** While active, map clicks drop temporary pins instead of selecting sites/assets/signals. This is deliberate for operator clarity. If a future slice needs concurrent selection + annotation, design that explicitly instead of weakening the mode boundary.
- **Annotation labels are operator-local and ephemeral.** They live only in local React state for the current browser session. If a future slice needs persistence or sharing, design backend and auth semantics explicitly instead of extending this state ad hoc.
- **Measurement mode intentionally owns map clicks.** While active, map clicks no longer select sites/assets/signals; they capture arbitrary coordinates instead. This is deliberate for operator clarity. If a future slice needs concurrent selection + measurement, design that explicitly instead of silently weakening the mode boundary.
- **Measurement geometry is great-circle enough for the current operator problem, not survey-grade.** Distance uses haversine and bearing uses initial great-circle bearing; there is no terrain, path snapping, or route-following logic in this slice.
- **Map signal caps block DB-backed scale testing.** `useSignalsLive` in [useSignals.ts](frontend/src/hooks/useSignals.ts) clamps `vessel_position` to 50 (see [liveSignals.ts](frontend/src/lib/liveSignals.ts) `LIVE_SIGNAL_LIMITS`), and `/api/signals` caps `per_page` at 200 ([base_controller.rb:144](backend/app/controllers/api/base_controller.rb#L144)). 6-1D sidesteps both via a `resilience.perf.bench_signal_count` localStorage override that feeds a synthetic `Signal[]` straight into MapPage, gated behind `resilience.perf`. The benchmark deliberately bypasses the live pipeline because reconcile cost, not ingestion, is the object of study. Do NOT lift either cap for prod — the cap is a product-deliberate noise guard, not an accidental limit.
- **Synthetic bench IDs produce 404s downstream.** Selecting a `bench-sig-NNNNNN` fires async fetches in `useEvidenceLinkedIds` and `useVessels` that 404. Harmless for the benchmark (jsMs is recorded before these resolve), but be aware if you extend the spec to assert on downstream state.
- **Maplibre `manualChunks` name removed from [vite.config.ts](frontend/vite.config.ts).** Under vite 8 / rolldown, manually naming the maplibre chunk re-wraps its UMD bundle and produces `Export 'maplibre_gl_exports' is not defined in module` at runtime, leaving `mapLoaded:false` permanently in the built bundle. The dynamic `import('maplibre-gl')` boundary at the MapPage call site already auto-chunks maplibre into `dist/assets/maplibre-gl-*.js` (~1024 kB), so removing the manual name preserves the lazy-load boundary while sidestepping the UMD re-wrap. Re-introduce a manual name only once rolldown handles UMD re-wrap correctly.
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
- Phase 6 Slice 6-1A — map signal-reconcile instrumentation + benchmark bridge
- Phase 6 Slice 6-1B — Playwright benchmark:map spec + npm script
- Phase 6 Slice 6-1C — paint-completion measurement + jsMs CI gate (incl. rAF-preemption fix and maplibre `manualChunks` removal)
- Phase 6 Slice 6-1D — multi-scale characterization (1k / 10k / 100k synthetic-signal bypass + per-tier baseline capture)
- Phase 6 Slice 6-1E.a — multi-run baseline (5 runs × 50 samples per tier) + per-tier gating decision tree
- Phase 6 Slice 6-1E.b — per-tier CI gates in `map-scale-benchmark.spec.ts` (1k mean+p95+max, 10k p95+max, 100k report-only) + `benchmark:map:scale` step in `frontend-perf` workflow
- project-skill consolidation / deep-review removal / repo-managed `.claude/skills`
