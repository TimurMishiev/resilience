---
name: execution_handoff
description: Active handoff file for the current phase, slice, validation, and takeover safety
type: project
---

# Resilience — Execution Handoff

Last updated: 2026-04-22

## Current Phase

Post-Phase-7 remediation (**active**)

(Phase 4 — Debrief closed. Phase 5 — Evidence Threading complete. Phase 6 Slice 6-1 fully shipped and closed in `aa07c91`. Phase 7 is closed with latest shipped tip `368e079`. Current work is audit-driven remediation before any new roadmap expansion.)

## Current Slice

**Audit remediation — Band A/B/C/D closed. CTO P1 parity + P2 fully shipped. Loop stopped on P3 (scope decision).**

All confirmed findings from the merged audit are closed. CTO P1 (globe-parity with four slices) and CTO P2 (alert triage in globe inspector) are fully shipped — see "Shipped In This Phase" for the commit chain. Two mentor-P3 refactors landed after P1 parity closed: `ASSET_FRESHNESS_FILL_ALPHA` hoisted to `freshness.ts` so map and globe share one source of truth for the fill-opacity curve (`e86d83c`), and per-signal-type default outlines precomputed out of the evidence-effect loop (`6646db5`).

Running under the approved autonomous loop. **Stopped on CTO P3** (product-direction decision, not a bug fix). User input required to proceed.

Next unresolved work:
- **CTO P3** — "Map + Debrief split workstation", 5 slices claimed. This is not a finding to fix; it's a product-direction decision. Per `cto_evaluation_roadmap.md` §4, needs explicit user alignment on whether portfolio signal alone justifies 5 slices vs a reduced scope vs defer. **Surface for user decision.**
- **Optional P1 follow-ups (deferred, not blocking):** freshness rendering on globe entities; signal-side evidence highlighting on PointPrimitives.
- **CTO P4** — deferred unless a 6th map tool is planned.

## Current Repo State

- Latest committed product slice: `6646db5` — per-signal-type default-outline precomputation (mentor P3)
- Prior product slice: `e86d83c` — asset fill-alpha curve hoisted to `freshness.ts` (mentor P3)
- Latest committed rotation: `1f427e5` — post-signal-evidence handoff rotation
- Working tree: **clean after rotation commit**
- Branch state: `main` pushed at `6646db5` (product); handoff rotation follows

## Phase 7 — Slice Plan

Sequenced:
- **7-1A** — `/map` measurement tool (**shipped** in `4ea3def`)
- **7-1A-followup** — measurement overlay paint-order hardening (**shipped** in `37f7a40`)
- **7-1B** — temporary map annotations (**shipped** in `5260480`)
- **7-1B-followup** — post-push hardening: `MapPoint` extraction, static aria-label + maxLength, keyboard a11y on both map tool toggles, hook-order comment, style-swap persistence test (**shipped** in `df19f42`)
- **7-1C** — session-local `/map` range rings with editable radii and NM/KM units (**shipped** in `45b09b8`)
- **7-1D** — session-local `/map` bearing line / azimuth tool with operator-entered heading and extent (**shipped** in `823dd05`)
- **7-1E** — session-local `/map` sector / fan overlay with operator-entered heading, arc, and extent (**shipped** in `f1960c7`)
- **7-1E-followup** — post-ship cleanup: shared map geodesy extraction, replay `as_of` hardening, AI catalog freshness-vs-load trade-off, full-fetch pagination rollout, and globe toolbar keyboard a11y (**shipped** in `51f8a3f`)
- **7-1E-followup-p3** — post-ship P3 cleanup on `fetchAllPaginated` + `useAll*` (worker-pool sibling short-circuit, non-null-assertion removal, test-name drift fix, `useAllAreasOfOperation` signature normalized) (**shipped** in `efd1ff8`)
- **replay-hardening-dateNow** — remove `Date.now()` defaults from shared library functions; thread `useReferenceTimeMs()` through admin pages; thread live clock explicitly through live-only call sites (`useTelemetryStream`, `coverage`, `assetPresentation`) (**shipped** in `368e079`)

## Shipped In This Phase (Phase 7)

- `4ea3def` — Phase 7 Slice 7-1A: `/map` measurement tool (session-local distance/bearing, no backend persistence, no globe parity)
- `37f7a40` — Phase 7 Slice 7-1A-followup: measurement overlay paint-order hardening (measurement geometry paints above dense signal layers; direct adapter proof added)
- `5260480` — Phase 7 Slice 7-1B: temporary map annotations (session-local pins with editable labels, explicit annotation mode, paint-order guard, mutual-exclusivity proof, and clear-all counter reset)
- `df19f42` — Phase 7 Slice 7-1B-followup: annotation-tool hardening (`MapPoint` extraction, annotation input hardening, keyboard-operable ANNOTATE/MEASURE toggles, and style-swap persistence proof)
- `45b09b8` — Phase 7 Slice 7-1C: `/map` range rings (session-local range-ring anchor, editable radii, NM/KM units, range-ring paint-order proof, and responsive tool-row fallback)
- `823dd05` — Phase 7 Slice 7-1D: `/map` bearing line / azimuth tool (session-local anchor, operator-entered heading and extent, NM/KM units, paint-order proof, style-swap persistence, four-tool exclusivity, and responsive tool-row continuity)
- `f1960c7` — Phase 7 Slice 7-1E: `/map` sector / fan overlay (session-local anchor, operator-entered heading/arc/extent, NM/KM units, sector paint-order proof, style-swap persistence, and five-tool exclusivity)
- `51f8a3f` — Phase 7 Slice 7-1E-followup: shared `projectGeodesicPoint` extraction, replay `as_of` fail-closed (400 on malformed), AI catalog cache removal (deliberate freshness-vs-load trade), full-fetch pagination rollout on `/map` `/globe` `/graph` with `MAX_CONCURRENT_PAGES = 6` worker-pool semaphore, and globe toolbar keyboard a11y
- `efd1ff8` — Phase 7 Slice 7-1E-followup-p3: `fetchAllPaginated` worker-pool sibling short-circuit on first rejection, explicit invariant error in place of non-null assertion, test-name drift fix, `useAllAreasOfOperation` signature normalized to match the other three `useAll*` hooks
- `368e079` — replay-hardening-dateNow: removed wall-clock defaults from shared library functions, threaded explicit reference clocks through admin/live call sites, and made replay clock choice compile-visible
- `43ea358` — Band D `F1`: BriefingPanel stale-response race fixed by capturing briefing context at generate time, rendering the captured context as the result header, and exporting from captured params rather than live selector state
- `e7eaccb` — Band D `O1`: `Metrics::Recorder::LATENCY_WINDOW` reconciled from `5.minutes` to `1.minute` to match the actual per-snapshot accumulation window (samples cleared on every snapshot; job runs every minute); `window_seconds` now truthfully equals 60
- `8ecc2c0` — Band D `J1`: new `Auth::PruneRevokedJwtsJob` deletes expired `RevokedJwt` rows on a daily schedule (`every day at 2:30am`); inverse of `RevokedJwt.active`; boundary-alignment spec locks the inactive ⇄ prunable contract
- `42f5af0` — Band D `M1`: `strong_migrations` 2.6.0 added to the default Gemfile group, baselined at `start_after = 20260415100001` via `config/initializers/strong_migrations.rb`; drift-guard spec fails if the baseline is ever bumped past an existing migration
- `327d7ca` — Band C `MT1`: telemetry SSE stream now filters per-payload against the viewer's `policy_scope(Asset)` asset-id set (computed once at stream open). Comment on `TelemetryReadingPolicy` documents that per-payload tenant filtering is controller dispatch, not Pundit. Zero simulator / broadcaster / schema changes. Five new request specs cover unrestricted, org-only, AO-only, compound org+AO, and empty-scope viewers
- `9b23365` — Band C `MT2`: recommendation generation is now per-tenant. `ContextAssembler.call(organization_id:)` scopes every query via site / AO / home_site anchors; `GeneratorService.call(organization_id:)` threads it and tags logs with tenant; `GenerationJob` enumerates `Organization.pluck(:id)` and runs one cycle per org (falls back to a single unscoped run when the deployment has no Organization rows — single-tenant backward compat). Per-tenant failures do not block remaining tenants. Zero schema / LLM-enricher / rule-engine changes. Sixteen new spec cases across assembler, generator, and job
- `2e874e2` — Band C `MT3`: correlation rule target resolution is now tenant-scoped via a three-branch fallback in `EvaluatorService.target_sites_scope` and the mirror predicate `rule_targets_site?`. AO-bound rules resolve via AO (unchanged); nil-AO rules owned by an org-scoped commander resolve to sites in the creator's organization; nil-AO rules owned by an admin with no org resolve to `Site.active` (admin-global unchanged). `CorrelationRule.active.includes(:created_by)` avoids the per-rule N+1 the creator lookup would otherwise introduce. No schema / migration / policy change. Six new spec cases using `contain_exactly` invariants
- `402cd00` — CTO P1 slice 1: `useReferenceTimeMs` threaded end-to-end through GlobePage → useGlobeEngine → sub-hooks (threaded but unused this slice — reserved for follow-up freshness rendering). Linked-entity cross-highlighting added on globe: selecting an asset outlines its home site; selecting a site outlines every asset rooted there. Color (`#5282ff`) + 4px outline width mirror the map's `site-linked-ring` / `asset-linked-ring` visual contract. Three new spec cases covering both directions + deselect. No backend / schema / auth / policy touched
- `d93d897` — CTO P1 slice 2: evidence-linked site ring on globe. `useGlobeSiteEntities` now applies a three-state outline (linked > evidence > default) with amber `#f5a623` width 3 for sites linked to the selected signal via rule matches. `GlobePage` calls `useEvidenceLinkedIds` with the same (selectedSiteId, selectedSignalId, asOf) args MapPage uses. Facade's `fromCssColorString` upgraded to preserve css on `_css` so tests assert on visible color, not just width. Also replaced slice-1's regex key-extraction with direct `sites` iteration (addresses slice-1 mentor P3). Two new spec cases covering evidence highlighting + linked-over-evidence precedence. No backend / schema / auth / policy touched
- `23a722d` — CTO P2: alert triage section on globe inspector. `GlobeInspectorPanel` now renders `MapSiteAlertsSection` inline when a site is selected (matches `MapSitePanel` placement after tasks). Three new props threaded through — `referenceTimeMs`, `canTriage`, `onSelectSignal` — all pass-throughs to the existing section. `GlobePage` computes `canTriageAlerts` via `useRole` and wires `onSelectSignal=onSignalClick` so alert-row clicks flow through the same route as Cesium entity picks. The alerts section's replay null-render discipline is inherited (no new gating). Component reused as-is despite `MapSite…` legacy name; rename deferred. Four new GlobeInspectorPanel cases (prop plumbing, canTriage false path, onSelectSignal bubble, site-absent no-render). No backend / schema / auth / policy / MapSiteAlertsSection touched
- `19c37e0` — CTO P1 follow-up (freshness rendering on globe assets): globe asset entities now modulate point-fill alpha by freshness using `deriveFreshness(last_reported_at, referenceTimeMs)`. Curve mirrors `useMapAssetLayers`'s circle-opacity table (fresh 0.94 / aging 0.72 / stale 0.46 / unavailable 0.32). `ASSET_FRESHNESS_THRESHOLDS` (6h / 24h) hoisted from `mapRenderData.ts` to `freshness.ts` so both surfaces share one source of truth. Consumes the previously-speculative `referenceTimeMs` plumbing from slice 1 — the `_referenceTimeMs: void` placeholder in `useGlobeEngine` is gone. Facade upgraded so `Color.withAlpha` preserves `_alpha` for tests. Two new spec cases (four-state curve + re-apply on clock advance). No backend / schema / auth / policy touched
- `e2171e5` — CTO P1 follow-up (signal-evidence outline on globe primitives): `useGlobeSignalPrimitives` now modulates signal `PointPrimitive.outlineColor` — amber `#f5a623` @ alpha 0.9 for evidence-linked, per-signal-type base @ alpha 0.35 for default. Mirrors `useMapSignalLayers:159-181`. `evidenceSignalIds` (previously destructured-and-discarded at slice 2) is now threaded through `useGlobeEngine` and consumed. Both halves of evidence highlighting — sites when a signal is selected, signals when a site is selected — are now live on globe. One new spec case asserting on visual contract (amber for listed, non-amber for unlisted, restoration on clear). No backend / schema / auth / policy touched. **P1 parity fully closed.**
- `e86d83c` — mentor P3 refactor: `ASSET_FRESHNESS_FILL_ALPHA: Record<FreshnessState, number>` hoisted to `lib/freshness.ts` so map and globe consume one source of truth for the fill-opacity curve (completes the shared-curve discipline that `ASSET_FRESHNESS_THRESHOLDS` already established). Stroke-opacity and text-opacity curves stay map-local because they're surface-specific paint attributes, not a shared concept. Zero visible-value change — same 0.94/0.72/0.46/0.32 numbers, different module.
- `6646db5` — mentor P3 refactor: `useGlobeSignalPrimitives` evidence-outline effect now precomputes `defaultOutlineByType: Map<SignalType, Color>` once per effect run instead of calling `Cesium.Color.fromCssColorString(...).withAlpha(...)` inside the per-signal loop. Brings the default branch in line with the already-hoisted `evidenceColor`. Idiomatic change, not perf-hot; explicit comment warns against regressing the hoist.

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

- Phase 7 remains closed.
- Audit remediation is active under the **full bulletproof sweep**:
  - Band D (F1, O1, J1, M1) — **shipped and pushed**
  - Band C (MT1, MT2, MT3) — **shipped and pushed (manual scope-approval mode)**
  - CTO P1 → P2 → (scope P3) → defer P4 — next
- Band A (`I1`, `G1`, `API1`, `D1`) and Band B (`I2`, `R1`) — shipped in `27831e1`.
- Band D `F1` — shipped in `43ea358`.
- Band D `O1` — shipped in `e7eaccb`.
- Band D `J1` — shipped in `8ecc2c0`.
- Band D `M1` — shipped in `42f5af0`.
- Band C `MT1` — shipped in `327d7ca`.
- Band C `MT2` — shipped in `9b23365`.
- Band C `MT3` — shipped in `2e874e2`.
- All confirmed findings in the merged audit backlog are now closed.
- CTO P1 slice 1 — shipped in `402cd00`.
- CTO P1 slice 2 — shipped in `d93d897`.
- CTO P2 — shipped in `23a722d`.
- CTO P1 follow-up (freshness fill alpha) — shipped in `19c37e0`.
- CTO P1 follow-up (signal-evidence outline) — shipped in `e2171e5`. **P1 parity fully closed.**
- Shared fill-alpha curve refactor — shipped in `e86d83c`.
- Default-outline precompute refactor — shipped in `6646db5`.
- **Loop stopped on CTO P3** (scope decision, explicit stop condition). Awaiting user direction on whether to adopt the 5-slice "split workstation", pursue a reduced scope, or defer.

## Next

- **Immediate next step:** user decision on CTO P3. The loop stopped here deliberately because P3 is a product-direction call, not a bug fix. Options to surface:
  - (a) **Full 5-slice split workstation** as claimed in the CTO evaluation. Portfolio-driven signal; real replay-authority design work upfront.
  - (b) **Reduced scope: debrief panel inline on the map page, no independent replay context.** Proves the pattern without the full workstation commitment.
  - (c) **Defer P3** as portfolio-aesthetic rather than operator-value.
- **P1 parity is now fully closed** — both evidence halves (sites when a signal is selected, signals when a site is selected) and freshness rendering are live on globe. No further P1 follow-ups are scoped.
- **External CTO evaluation (2026-04-22) — briefing:** see [memory/cto_evaluation_roadmap.md](cto_evaluation_roadmap.md). Full third-party report + per-priority disposition. P0 (`Date.now()` defaults → required) shipped in `368e079`. P1 + P2 now shipped; P3 awaits scope decision; P4 deferred unless a 6th map tool is planned.
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
cd /Users/timurmishiev/Desktop/Code/resilience/backend && TEST_DATABASE_PORT=5434 /Users/timurmishiev/.rbenv/shims/bundle exec rspec spec/requests/api/sites_spec.rb spec/requests/api/ai_spec.rb spec/services/ai/ontology_query_service_spec.rb spec/services/ai/filter_service_spec.rb spec/services/ai/signal_filter_service_spec.rb
cd /Users/timurmishiev/Desktop/Code/resilience/backend && TEST_DATABASE_PORT=5434 /Users/timurmishiev/.rbenv/shims/bundle exec rspec spec/jobs/correlations/evaluate_recent_job_spec.rb spec/config/recurring_spec.rb
cd /Users/timurmishiev/Desktop/Code/resilience/backend && TEST_DATABASE_PORT=5434 /Users/timurmishiev/.rbenv/shims/bundle exec rspec spec/requests/api/signal_rule_matches_spec.rb
cd /Users/timurmishiev/Desktop/Code/resilience/backend && TEST_DATABASE_PORT=5434 /Users/timurmishiev/.rbenv/shims/bundle exec rspec spec/services/telemetry/partition_manager_spec.rb
cd /Users/timurmishiev/Desktop/Code/resilience/backend && TEST_DATABASE_PORT=5434 /Users/timurmishiev/.rbenv/shims/bundle exec rspec spec/services/feeds/gpsjam_ingestion_service_spec.rb
cd /Users/timurmishiev/Desktop/Code/resilience/backend && TEST_DATABASE_PORT=5434 /Users/timurmishiev/.rbenv/shims/bundle exec rspec spec/services/replay/projection_service_spec.rb
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run src/test/useChokepoints.test.tsx src/test/MapPage.test.tsx src/test/GlobePage.test.tsx
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run src/test/MapPage.test.tsx src/test/GlobePage.test.tsx src/test/GraphPage.test.tsx src/test/fetchAllPaginated.test.ts src/test/mapGeodesy.test.ts src/test/mapBearingLine.test.ts src/test/mapRangeRings.test.ts src/test/mapSectorOverlay.test.ts
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx tsc -p tsconfig.app.json --noEmit
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx eslint src/api/chokepoints.ts src/hooks/useChokepoints.ts src/pages/MapPage.tsx src/pages/GlobePage.tsx src/test/useChokepoints.test.tsx src/test/MapPage.test.tsx src/test/GlobePage.test.tsx
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx eslint src/api/client.ts src/api/sites.ts src/api/tasks.ts src/api/assets.ts src/api/areas_of_operation.ts src/components/globe/GlobeToolbar.tsx src/hooks/useAreasOfOperation.ts src/hooks/useAssets.ts src/hooks/useSites.ts src/hooks/useTasks.ts src/hooks/fetchAllPaginated.ts src/lib/mapBearingLine.ts src/lib/mapGeodesy.ts src/lib/mapRangeRings.ts src/lib/mapSectorOverlay.ts src/pages/GlobePage.tsx src/pages/GraphPage.tsx src/pages/MapPage.tsx src/test/GlobePage.test.tsx src/test/GraphPage.test.tsx src/test/MapPage.test.tsx src/test/fetchAllPaginated.test.ts src/test/mapGeodesy.test.ts
git -C /Users/timurmishiev/Desktop/Code/resilience diff --check
```

## Last Validation Results (mentor-P3 refactors — shared fill-alpha curve + default-outline precompute, committed in `e86d83c` + `6646db5`, 2026-04-23)

- Modified frontend files: `src/lib/freshness.ts`, `src/hooks/globe/useGlobeAssetEntities.ts`, `src/hooks/map/useMapAssetLayers.ts` (`e86d83c`); `src/hooks/globe/useGlobeSignalPrimitives.ts` (`6646db5`)
- No new test cases — both refactors are idiomatic, not behavior-changing. The existing four-state freshness curve tests (0.94/0.72/0.46/0.32) continue to assert the same values, now sourced from the hoisted `ASSET_FRESHNESS_FILL_ALPHA` Record.
- Full validation:
  - `npx vitest run` → **672 / 672 pass across 90 files**
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - `npx eslint` on touched files → **0 issues**
  - `git diff --check` → **clean**
- Diff stat: `e86d83c` = 3 files, +26/-19. `6646db5` = 1 file, +18/-6.
- Why the refactor: both commits close mentor-review P3 items from the preceding product slices (freshness-alpha curve was duplicated across map/globe; per-iteration `fromCssColorString` allocation was asymmetric with the already-hoisted `evidenceColor`). "Finish the job when you cross the surface boundary" + "hoist allocations out of loops by default" — principles named in prior reviews, applied here consistently.

## Prior Validation Results (CTO P1 follow-up — signal-evidence outline on globe primitives, committed in `e2171e5`, 2026-04-23)

- Modified frontend files: `src/hooks/globe/useGlobeSignalPrimitives.ts`, `src/hooks/useGlobeEngine.ts`, `src/pages/GlobePage.tsx`
- Modified spec files: `src/test/useGlobeEngine.test.ts` (+1 case, FakePrimitive extended with outlineColor/outlineWidth)
- Focused frontend validation:
  - `npx vitest run src/test/useGlobeEngine.test.ts` → **46 / 46 pass**
- Full validation:
  - `npx vitest run` → **672 / 672 pass across 90 files** (+1 vs freshness baseline of 671)
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - `npx eslint` on 4 touched files → **0 issues**
  - `git diff --check` → **clean**
- Diff stat: 4 files, +92/-5 lines.
- Step 0 verification: confirmed globe signal primitives had zero evidence consumption pre-slice; `evidenceSignalIds` was already emitted by `useEvidenceLinkedIds` and was destructured-and-discarded at P1 slice 2 with a deferral comment. This slice pays that debt.

## Prior Validation Results (CTO P1 follow-up — globe freshness fill alpha, committed in `19c37e0`, 2026-04-23)

- Modified frontend files: `src/hooks/globe/useGlobeAssetEntities.ts`, `src/hooks/useGlobeEngine.ts`, `src/lib/freshness.ts`, `src/lib/mapRenderData.ts`
- Modified spec files: `src/test/useGlobeEngine.test.ts` (+2 cases, facade `withAlpha` now preserves `_alpha`)
- Focused frontend validation:
  - `npx vitest run src/test/useGlobeEngine.test.ts` → **45 / 45 pass** (43 existing + 2 new)
- Full validation:
  - `npx vitest run` → **671 / 671 pass across 90 files** (+2 vs P2 baseline of 669)
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - `npx eslint` on 5 touched files → **0 issues**
  - `git diff --check` → **clean**
- Diff stat: 5 files, +166/-24 lines. `ASSET_FRESHNESS_THRESHOLDS` hoisted to `freshness.ts`; map and globe now share one source of truth (eliminates silent-drift risk).
- Step 0 verification: confirmed globe had zero freshness consumption pre-slice; map has it via `useMapAssetLayers:62-69` circle-opacity table. Curve ported verbatim.

## Prior Validation Results (CTO P2 — globe alert triage in inspector, committed in `23a722d`, 2026-04-23)

- Modified frontend files: `src/components/GlobeInspectorPanel.tsx`, `src/pages/GlobePage.tsx`
- Modified spec files: `src/test/GlobeInspectorPanel.test.tsx` (+4 cases, `MapSiteAlertsSection` mocked), `src/test/GlobePage.test.tsx` (+1 mock — `useRole`)
- Focused frontend validation:
  - `npx vitest run src/test/GlobeInspectorPanel.test.tsx src/test/GlobePage.test.tsx` → **25 / 25 pass**
- Full validation:
  - `npx vitest run` → **669 / 669 pass across 90 files** (+4 vs P1-slice-2 baseline of 665)
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - `npx eslint` on 4 touched files → **0 issues**
  - `git diff --check` → **clean**
- Diff stat: 4 files, +138/-0 lines.
- Step 0 verification: confirmed globe inspector had zero alert / SignalRuleMatch / ack / escalate surfaces pre-slice. Narrow scope held — no rename of the map-named-but-entity-agnostic `MapSiteAlertsSection`, no changes to the section itself.

## Prior Validation Results (CTO P1 slice 2 — globe evidence-linked site ring, committed in `d93d897`, 2026-04-22)

- Modified frontend files: `src/hooks/useGlobeEngine.ts`, `src/hooks/globe/useGlobeSiteEntities.ts`, `src/pages/GlobePage.tsx`
- Modified spec files: `src/test/useGlobeEngine.test.ts` (+2 cases, facade color-preservation upgrade)
- Focused frontend validation:
  - `npx vitest run src/test/useGlobeEngine.test.ts src/test/GlobePage.test.tsx src/test/GlobeInspectorPanel.test.tsx` → **64 / 64 pass**
- Full validation:
  - `npx vitest run` → **665 / 665 pass across 90 files** (+2 vs slice 1 baseline of 663)
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - `npx eslint` on touched files → **0 issues**
  - `git diff --check` → **clean**
- Diff stat: 4 files, +145/-18 lines.
- Step 0 verification: confirmed globe had no evidence-ring rendering pre-slice. Addressed prior-slice P3 feedback (direct `sites` iteration instead of regex key-extraction; color invariants in addition to width).

## Prior Validation Results (CTO P1 slice 1 — globe `useReferenceTimeMs` + linked-entity highlighting, committed in `402cd00`, 2026-04-22)

- Modified frontend files: `src/hooks/useGlobeEngine.ts`, `src/hooks/globe/useGlobeSiteEntities.ts`, `src/hooks/globe/useGlobeAssetEntities.ts`, `src/lib/globeEngineHelpers.ts`, `src/pages/GlobePage.tsx`
- Modified spec files: `src/test/useGlobeEngine.test.ts` (+3 cases, FakeEntity.point extended with outlineColor/outlineWidth)
- Focused frontend validation:
  - `npx vitest run src/test/useGlobeEngine.test.ts` → **41 / 41 pass** (38 existing + 3 new)
  - `npx vitest run src/test/GlobePage.test.tsx src/test/GlobeInspectorPanel.test.tsx` → **21 / 21 pass** (adjacent regression)
- Full validation:
  - `npx vitest run` → **663 / 663 pass across 90 files** (+3 vs MT3 baseline of 660)
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - `npx eslint` on 6 touched files → **0 issues**
  - `git diff --check` → **clean**
- Diff stat: 6 files, +225/-2 lines.
- Step 0 verification: confirmed P1 claim reproduced — zero `useReferenceTimeMs`/`linkedSiteId`/`evidenceSiteIds` in globe tree at pre-slice HEAD.

## Prior Validation Results (shipped remediation slice — Band C `MT3` correlation target sites tenant-scoped, committed in `2e874e2`, 2026-04-22)

- Modified backend files: `backend/app/services/correlations/evaluator_service.rb`
- Modified spec files: `backend/spec/services/correlations/evaluator_service_spec.rb` (+6 cases)
- Touched findings doc: `.claude/skills/resilience-remediation/references/findings.md`
- Touched handoff: `memory/execution_handoff.md`
- Focused backend validation:
  - `TEST_DATABASE_PORT=5434 bundle exec rspec spec/services/correlations/evaluator_service_spec.rb` → **38 / 38 pass**
  - `TEST_DATABASE_PORT=5434 bundle exec rspec spec/services/correlations/ spec/jobs/correlations/ spec/policies/correlation_rule_policy_spec.rb spec/requests/api/correlation_rules_spec.rb spec/requests/api/signals_spec.rb` → **196 / 196 pass** (adjacent regression)
- Full validation:
  - `TEST_DATABASE_PORT=5434 bundle exec rspec` → **2212 examples, 0 failures** (+6 vs MT2 baseline of 2206)
  - `bundle exec brakeman --no-pager --exit-on-warn` → **0 warnings, 0 errors**
  - `git diff --check` → **clean**
- Diff stat: 2 files, +131/-2 lines. Test invariants use `contain_exactly` per MT2 mentor feedback.

## Prior Validation Results (shipped remediation slice — Band C `MT2` recommendation generation per-tenant, committed in `9b23365`, 2026-04-22)

- Modified backend files: `backend/app/services/recommendations/context_assembler.rb`, `backend/app/services/recommendations/generator_service.rb`, `backend/app/jobs/recommendations/generation_job.rb`
- Modified spec files: `backend/spec/services/recommendations/context_assembler_spec.rb`, `backend/spec/services/recommendations/generator_service_spec.rb`, `backend/spec/jobs/recommendations/generation_job_spec.rb` (+16 cases)
- Touched findings doc: `.claude/skills/resilience-remediation/references/findings.md`
- Touched handoff: `memory/execution_handoff.md`
- Focused backend validation:
  - `TEST_DATABASE_PORT=5434 bundle exec rspec spec/services/recommendations/ spec/jobs/recommendations/ spec/policies/recommendation_policy_spec.rb spec/requests/api/recommendations_spec.rb` → **154 / 154 pass**
- Full validation:
  - `TEST_DATABASE_PORT=5434 bundle exec rspec` → **2206 examples, 0 failures** (+16 vs MT1 baseline of 2190)
  - `bundle exec brakeman --no-pager --exit-on-warn` → **0 warnings, 0 errors**
  - `git diff --check` → **clean**
- Diff stat: 6 files, +405/-53 lines. Observability (per mentor P3 on MT1): per-tenant log lines in GenerationJob and GeneratorService.

## Prior Validation Results (shipped remediation slice — Band C `MT1` telemetry SSE org + AO scoping, committed in `327d7ca`, 2026-04-22)

- Modified backend files: `backend/app/controllers/api/telemetry_controller.rb`, `backend/app/policies/telemetry_reading_policy.rb`
- Modified spec files: `backend/spec/requests/api/telemetry_spec.rb` (+5 cases)
- Touched findings doc: `.claude/skills/resilience-remediation/references/findings.md`
- Touched handoff: `memory/execution_handoff.md`
- Focused backend validation:
  - `TEST_DATABASE_PORT=5434 bundle exec rspec spec/requests/api/telemetry_spec.rb` → **16 / 16 pass** (11 existing + 5 new tenant-filter cases)
  - `TEST_DATABASE_PORT=5434 bundle exec rspec spec/policies/asset_policy_spec.rb spec/policies/telemetry_reading_policy_spec.rb spec/services/telemetry/broadcaster_spec.rb` → **28 / 28 pass** (adjacent regression check)
- Full validation:
  - `TEST_DATABASE_PORT=5434 bundle exec rspec` → **2190 examples, 0 failures** (+5 vs M1 baseline of 2185)
  - `bundle exec brakeman --no-pager --exit-on-warn` → **0 warnings, 0 errors**
  - `git diff --check` → **clean**
- Diff stat: 3 files, +162/-0 lines (matches approved scope).

## Prior Validation Results (shipped remediation slice — Band D `M1` migration safety program seed, committed in `42f5af0`, 2026-04-22)

- Modified backend files: `backend/Gemfile`, `backend/Gemfile.lock`
- New backend files: `backend/config/initializers/strong_migrations.rb`, `backend/spec/config/strong_migrations_spec.rb`
- Touched findings doc: `.claude/skills/resilience-remediation/references/findings.md`
- Touched handoff: `memory/execution_handoff.md`
- Focused backend validation:
  - `TEST_DATABASE_PORT=5434 bundle exec rspec spec/config/strong_migrations_spec.rb` → **2 / 2 pass** (gem-loaded + drift-guard invariant)
- Full validation:
  - `TEST_DATABASE_PORT=5434 bundle exec rspec` → **2185 examples, 0 failures** (+2 new M1 cases vs J1 baseline)
  - `bundle exec brakeman --no-pager --exit-on-warn` → **0 warnings, 0 errors**
  - `bundle exec bundler-audit check --update` → **0 vulnerabilities** (includes new `strong_migrations 2.6.0` dependency)
  - `git diff --check` → **clean**
- Gemfile.lock delta is tight: only `strong_migrations 2.6.0` added (activerecord >= 7.2 dependency already satisfied); no collateral gem bumps.

## Prior Validation Results (shipped remediation slice — Band D `J1` RevokedJwt pruning job, committed in `8ecc2c0`, 2026-04-22)

- New backend files: `backend/app/jobs/auth/prune_revoked_jwts_job.rb`, `backend/spec/jobs/auth/prune_revoked_jwts_job_spec.rb`
- Modified backend files: `backend/config/recurring.yml`
- Failing-first proof (pre-fix): `NameError: uninitialized constant Auth` when running the new spec against missing job
- Focused backend validation (post-fix):
  - `TEST_DATABASE_PORT=5434 bundle exec rspec spec/jobs/auth spec/models/revoked_jwt_spec.rb spec/requests/api/auth_sessions_spec.rb spec/config/recurring_spec.rb` → **18 / 18 pass** (3 new job cases + 5 model + 9 auth-sessions request + 1 recurring.yml)
- Full validation:
  - `TEST_DATABASE_PORT=5434 bundle exec rspec` → **2183 examples, 0 failures** (+3 new J1 cases vs O1 baseline)
  - `npx vitest run` → **660 / 660 pass across 90 files**
  - `npx tsc --noEmit` → **0 errors**
  - `git diff --check` → **clean**

## Prior Validation Results (shipped remediation slice — Band D `O1` metrics latency window reconciliation, committed in `e7eaccb`, 2026-04-22)

- Touched backend files: `backend/app/services/metrics/recorder.rb`, `backend/spec/services/metrics/recorder_spec.rb`
- Focused backend validation:
  - `TEST_DATABASE_PORT=5434 bundle exec rspec spec/services/metrics spec/jobs/metrics spec/requests/api/operational_health_spec.rb spec/models/operational_status_spec.rb` → **33 / 33 pass** (includes new `persists a window_seconds that matches the actual snapshot cadence` case which failed pre-fix with `expected 60, got 300`)
- Full validation:
  - `TEST_DATABASE_PORT=5434 bundle exec rspec` → **2180 examples, 0 failures**
  - `npx vitest run` → **660 / 660 pass across 90 files**
  - `npx tsc --noEmit` → **0 errors**
  - `git diff --check` → **clean**

## Prior Validation Results (shipped remediation slice — Band D `F1` BriefingPanel stale-response race, committed in `43ea358`, 2026-04-22)

- Touched frontend files: `src/components/BriefingPanel.tsx`, `src/test/BriefingPanel.test.tsx`
- Touched findings doc: `.claude/skills/resilience-remediation/references/findings.md`
- Focused frontend validation:
  - `npx vitest run src/test/BriefingPanel.test.tsx` → **9 / 9 pass** (6 existing + 3 new F1 cases covering captured header, captured-state preservation after selector change, and captured-param export)
- Full frontend validation:
  - `npx vitest run` → **660 / 660 pass across 90 files**
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - `npx eslint src/components/BriefingPanel.tsx src/test/BriefingPanel.test.tsx` → **0 issues**
  - `git diff --check` → **clean**
- Backend: no backend files touched in this tranche; no new rspec run required.

## Prior Validation — Band A + Band B (shipped in `27831e1`, 2026-04-22)

- Combined backend validation across full remediation tranche:
  - `TEST_DATABASE_PORT=5434 /Users/timurmishiev/.rbenv/shims/bundle exec rspec spec/jobs/correlations/evaluate_recent_job_spec.rb spec/config/recurring_spec.rb spec/requests/api/signal_rule_matches_spec.rb spec/requests/api/vessels_spec.rb spec/services/telemetry/partition_manager_spec.rb spec/services/feeds/gpsjam_ingestion_service_spec.rb spec/services/replay/projection_service_spec.rb` → **85 examples, 0 failures**
  - note: PostgreSQL emitted local non-failing `unknown OID ... location` / `unknown OID ... pg_advisory_lock` noise
- Focused frontend validation:
  - `npx vitest run src/test/useChokepoints.test.tsx src/test/MapPage.test.tsx src/test/GlobePage.test.tsx` → **54 / 54 pass**
  - `npx vitest run` (full suite) → **657 / 657 pass across 90 files**
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - `npx eslint` touched frontend files → **0 issues**
- `git diff --check` → **clean**
- API1 scope expansion (added after Codex's initial tranche): `VesselsController#tracks` now uses `parse_datetime_param!` fail-closed behavior; regression coverage in `spec/requests/api/vessels_spec.rb` (2 new examples, 22 total). Same-pattern audit confirmed no other `safe_parse_datetime` caller has wrong-data risk.

## Prior Validation Results (replay-hardening-dateNow tranche, shipped in `368e079`, 2026-04-22)

- Touched frontend files: 12 (6 lib signatures + 6 call-site / test updates)
- Focused frontend validation:
  - `npx vitest run src/test/mapSignalRendering.test.ts` → **8 / 8 pass**
- Full frontend validation:
  - `npx vitest run` → **656 / 656 pass across 89 files**
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - `npx eslint` on all 12 touched files → **0 issues**
  - `git diff --check` → **clean**
- Backend: no backend files touched in this tranche; no new rspec run required.

## Prior Validation — Phase 7 Slice 7-1E-followup-p3 (shipped in `efd1ff8`, 2026-04-22)

- Touched frontend files: `src/hooks/fetchAllPaginated.ts`, `src/hooks/useAreasOfOperation.ts`, `src/test/fetchAllPaginated.test.ts`
- Full frontend validation:
  - `npx vitest run` → **656 / 656 pass across 89 files** (new "short-circuits sibling workers when any worker rejects" test locks in post-error bounded-fetch behavior)
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - `npx eslint src/hooks/fetchAllPaginated.ts src/hooks/useAreasOfOperation.ts src/test/fetchAllPaginated.test.ts` → **0 issues**
  - `git diff --check` → **clean**
- Backend: no backend files touched in this tranche; no new rspec run required.

## Prior Validation — Phase 7 Slice 7-1E-followup (shipped in `51f8a3f`, 2026-04-22)

- Focused backend validation:
  - `TEST_DATABASE_PORT=5434 /Users/timurmishiev/.rbenv/shims/bundle exec rspec spec/requests/api/sites_spec.rb spec/requests/api/ai_spec.rb spec/services/ai/ontology_query_service_spec.rb spec/services/ai/filter_service_spec.rb spec/services/ai/signal_filter_service_spec.rb` → **89 examples, 0 failures**
- Focused frontend validation:
  - `npx vitest run src/test/MapPage.test.tsx src/test/GlobePage.test.tsx src/test/GraphPage.test.tsx src/test/fetchAllPaginated.test.ts src/test/mapGeodesy.test.ts src/test/mapBearingLine.test.ts src/test/mapRangeRings.test.ts src/test/mapSectorOverlay.test.ts` → **75 / 75 pass across 8 files**
- Full frontend validation:
  - `npx vitest run` → **655 / 655 pass across 89 files** (added `fetchAllPaginated` concurrency-cap test proving peak in-flight = `MAX_CONCURRENT_PAGES` across 12 pages)
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - touched-file ESLint on cleanup files → **0 issues**
  - `git diff --check` → **clean**
- Baseline backend note:
  - system `bundle exec rspec` is still blocked locally by Bundler `2.7.2` env drift; the meaningful backend validation path above passed
  - full backend green is **not** claimed here; in this local env, untouched `spec/requests/api/telemetry_spec.rb` and `spec/services/telemetry/simulator_service_spec.rb` still fail because the test DB's `telemetry_readings` partitions do not cover `2026-04-22`

## Prior committed product validation (Phase 7 Slice 7-1E, shipped in `f1960c7`, 2026-04-21)

- Focused sector validation:
  - `npx vitest run src/test/mapSectorOverlay.test.ts src/test/MapPage.test.tsx src/test/useMapLibreEngine.test.ts` → **93 / 93 pass**
- Full frontend validation:
  - `npx vitest run` → **641 / 641 pass across 87 files**
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - touched-file ESLint on 7-1E files → **0 issues**
  - `git diff --check` → **clean**
- No backend validation was required for this slice because the tranche is frontend-only and introduces no API/schema/runtime-backend changes.

### Prior committed product validation (Phase 7 Slice 7-1D, shipped in `823dd05`, 2026-04-21)

- Focused bearing-line validation:
  - `npx vitest run src/test/mapBearingLine.test.ts src/test/MapPage.test.tsx src/test/useMapLibreEngine.test.ts` → **87 / 87 pass**
- Full frontend validation:
  - `npx vitest run` → **633 / 633 pass across 86 files**
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - touched-file ESLint on 7-1D files → **0 issues**
  - `git diff --check` → **clean**
- No backend validation was required for this slice because the tranche is frontend-only and introduces no API/schema/runtime-backend changes.

### Prior committed product validation (Phase 7 Slice 7-1C, shipped in `45b09b8`, 2026-04-21)

- Focused range-ring validation:
  - `npx vitest run src/test/mapRangeRings.test.ts src/test/MapPage.test.tsx src/test/useMapLibreEngine.test.ts` → **82 / 82 pass**
- Full frontend validation:
  - `npx vitest run` → **625 / 625 pass across 85 files**
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - touched-file ESLint on 7-1C files → **0 issues**
  - `git diff --check` → **clean**
- No backend validation was required for this slice because the tranche is frontend-only and introduces no API/schema/runtime-backend changes.

### Prior committed product validation (Phase 7 Slice 7-1B-followup, shipped in `df19f42`, 2026-04-20)

- Focused annotation validation:
  - `npx vitest run src/test/MapPage.test.tsx src/test/useMapLibreEngine.test.ts` → **73 / 73 pass**
- Full frontend validation:
  - `npx vitest run` → **616 / 616 pass across 84 files**
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - touched-file ESLint on 7-1B-followup files → **0 issues**
  - `git diff --check` → **clean**
- No backend validation was required for this slice because the tranche is frontend-only and introduces no API/schema/runtime-backend changes.

### Prior committed product validation (Phase 7 Slice 7-1B, shipped in `5260480`, 2026-04-20)

- Focused annotation validation:
  - `npx vitest run src/test/MapPage.test.tsx src/test/useMapLibreEngine.test.ts` → **72 / 72 pass**
- Full frontend validation:
  - `npx vitest run` → **613 / 613 pass across 84 files**
  - `npx tsc -p tsconfig.app.json --noEmit` → **0 errors**
  - touched-file ESLint on 7-1B files → **0 issues**
  - `git diff --check` → **clean**
- No backend validation was required for this slice because the tranche is frontend-only and introduces no API/schema/runtime-backend changes.

### Prior committed product validation (Phase 7 Slice 7-1A-followup, shipped in `37f7a40`, 2026-04-20)

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
- **Map signal caps block DB-backed scale testing.** `useSignalsLive` in [useSignals.ts](frontend/src/hooks/useSignals.ts) clamps `vessel_position` to 50 (see [liveSignals.ts](frontend/src/lib/liveSignals.ts) `LIVE_SIGNAL_LIMITS`), and `/api/signals` caps `per_page` at 200 ([base_controller.rb:164](backend/app/controllers/api/base_controller.rb#L164)). 6-1D sidesteps both via a `resilience.perf.bench_signal_count` localStorage override that feeds a synthetic `Signal[]` straight into MapPage, gated behind `resilience.perf`. The benchmark deliberately bypasses the live pipeline because reconcile cost, not ingestion, is the object of study. Do NOT lift either cap for prod — the cap is a product-deliberate noise guard, not an accidental limit.
- **Synthetic bench IDs produce 404s downstream.** Selecting a `bench-sig-NNNNNN` fires async fetches in `useEvidenceLinkedIds` and `useVessels` that 404. Harmless for the benchmark (jsMs is recorded before these resolve), but be aware if you extend the spec to assert on downstream state.
- **Maplibre `manualChunks` name removed from [vite.config.ts](frontend/vite.config.ts).** Under vite 8 / rolldown, manually naming the maplibre chunk re-wraps its UMD bundle and produces `Export 'maplibre_gl_exports' is not defined in module` at runtime, leaving `mapLoaded:false` permanently in the built bundle. The dynamic `import('maplibre-gl')` boundary at the MapPage call site already auto-chunks maplibre into `dist/assets/maplibre-gl-*.js` (~1024 kB), so removing the manual name preserves the lazy-load boundary while sidestepping the UMD re-wrap. Re-introduce a manual name only once rolldown handles UMD re-wrap correctly.
- **CI `frontend-perf` job now runs two benchmarks (globe + map) against the same Docker app.** First run is likely to expose CI-runner variance in both jsMs and paintMs. If jsMs gate is too tight on GitHub-hosted runners, raise the spec floors (NOT the multiplier) and re-anchor per real CI numbers, or use the env overrides (`MAP_BENCH_MAX_JS_*`). Don't skip the spec on CI pre-emptively — confirm by running.
- **paintMs is reported but not asserted.** Under swiftshader it ranges 100–1444ms across 50 local samples; any operator-felt-time regression detection needs a real-GPU run (local dev, staging, or a future CI runner with GPU pass-through). paintMs numbers in `frontend-perf-report` artifact are for observability only.
- Backend local validation still needs the repo Ruby path:
  - `TEST_DATABASE_PORT=5434 /Users/timurmishiev/.rbenv/shims/bundle exec ...`
  - the system `bundle` path still fails on the known Bundler `2.7.2` mismatch
- Full backend suite is not globally green in this local env:
  - untouched `spec/requests/api/telemetry_spec.rb` and `spec/services/telemetry/simulator_service_spec.rb` currently fail with `PG::CheckViolation` because the test DB's `telemetry_readings` partitions do not cover `2026-04-22`
  - treat that as environment drift unless the partitions/seed window are extended
- Frontend type-check must continue using:
  - `npx tsc -p tsconfig.app.json --noEmit`
  - the loose root `tsc --noEmit` is not authoritative for this repo
- **`AlertChainDrawer` mount convention on `/map`.** Each of `MapSignalAlertsSection` and `MapSiteAlertsSection` mounts its own `AlertChainDrawer` instance with local state. Safe today because `MapSignalPanel` and `MapSitePanel` are mutually exclusive in `MapSelectionPanels` — only one is rendered at any time, so only one drawer exists in the tree. If a future slice mounts both panels simultaneously, or mounts `EvidenceDrawer` on `/map` (which itself nests an `AlertChainDrawer`), reconcile to a single coordinator at `MapPage` or `MapSelectionPanels` level. Same reconciliation note as 5-2A.
- Both sections already null-render during replay (`if (isReplaying) return null`). The Chain button therefore never appears in replay, which matches `AlertChainDrawer`'s existing design (never opened from a replay context). If a future surface renders alert rows during replay, the chain drawer's replay semantics need to be re-evaluated.
- **`AlertChainDrawer.referenceTimeMs` is opt-in.** Callers without a replay-aware clock (e.g. `AlertTriagePage`, `IncidentAlertsTab`, `SiteDetailPage`, `AlertsPanel`, `EvidenceDrawer`) intentionally omit the prop and get no stale-basis indicator. This is correct — the drawer must never wall-clock (`react-hooks/purity` forbids `Date.now()` in the component body, and replay correctness forbids it anyway). If a future surface wants the indicator, it must thread a real reference clock through.
- Evidence resolution is scoped to the `/api/recommendations` surface only. It does **not** widen any other API that happens to render raw `evidence` JSONB.
- Replay intentionally returns both `alert: null` and `label: null` for matches whose `fired_at > as_of`. Do not "helpfully" fall back to live state — that would leak future state into replay.
- `Current Repo State` records the latest pushed tip SHA. Product-slice SHAs still live in "Shipped In This Phase"; the pushed tip may be a doc-only rotation commit.

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
