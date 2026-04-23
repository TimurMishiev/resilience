---
name: cto_evaluation_roadmap
description: Third-party CTO evaluation (93/100) and proposed path to 97 — full report, current status per priority, and open evaluation items for Codex
type: project
---

# CTO Evaluation — Resilience Platform

**Source:** Third-party model acting as CTO at a frontier defense-tech company (Palantir / Anduril / Rune Technologies)
**Evaluation date:** 2026-04-22
**Evaluated commit:** `823dd05` + uncommitted Phase 7 Slice 7-1E (sector overlay)
**Current HEAD (2026-04-22):** `e2d02c2` (post Band A + Band B remediation, handoff rotated)
**Current score per report:** 93/100, with a claimed path to 97/100 through 4 prioritized items
**Purpose of this file:** Give Codex the same source material Claude saw so both can collaborate on what's valid, what's not, and what to ship next. Claude has not pre-judged P1–P4 — those are open for Codex to evaluate.

---

## How To Use This File

1. Read the full report in §2 below — this is the third-party model's reasoning verbatim.
2. Read §3 for current disposition per priority (what's shipped, what's open).
3. For each open item in §4, verify the claim against current code before deciding whether to ship it. Do not accept "97/100" as a goal on its own — the underlying reasoning is what matters.
4. Update `memory/execution_handoff.md` with your decision if you adopt or reject a priority.

---

## 1. Executive Summary (Claude's paraphrase)

The third-party model judged the current platform as staff-level operator software (93/100), with specific praise for:

- Authorization / multi-tenancy (org + AO scoping, 30 Pundit policies, `verify_authorized`)
- Audit trail + replay pipeline (`Audit::EventWriter`, `Replay::ProjectionService`, `as_of` threading)
- Correlation engine optimistic locking (`RuleFiringService` cooldown claim)
- AI subsystem scoping + circuit breaker
- Real-time infra (`PostgresRelay` with dedicated listener + health registry)
- Frontend lazy loading + sub-hook decomposition on map engine
- 4-job CI pipeline with perf gates
- Test quality (race-condition tests, adapter-level engine tests, authorization boundary tests — 2,907 assertions total)

It proposed four gaps to close to reach 97/100:

| Priority | Work | Claimed impact | Claimed effort |
|----------|------|---------------|----------------|
| P0 | `Date.now()` defaults → required | +0.5 | 30 min |
| P1 | Globe evidence highlighting + `useReferenceTimeMs` | +1.0 | 1 slice |
| P2 | Globe alert triage in inspector | +1.0 | 1 slice |
| P3 | Map + Debrief split workstation | +1.0 | 5 slices |
| P4 | MapPage decomposition | +0.5 | 1–2 slices (only if 6th tool planned) |

P0 was shipped in `368e079` (see §3). P1–P4 are open.

---

## 2. Full CTO Report (verbatim)

> # Resilience — CTO Evaluation Report
>
> **Evaluator perspective:** CTO at a frontier defense-tech company (Palantir / Anduril / Rune Technologies)
> **Evaluation date:** April 22, 2026
> **Commit:** `823dd05` + uncommitted Phase 7 Slice 7-1E (sector overlay)
> **Purpose:** Evaluate platform maturity, developer capability, and path to 97/100
>
> ---
>
> ## 1. Platform Overview
>
> | Metric | Value |
> |--------|-------|
> | Frontend production code | 219 files · 32,000 lines TypeScript/TSX |
> | Backend production code | 171 files · 17,300 lines Ruby |
> | Frontend tests | 17,324 lines (54% test-to-prod ratio) |
> | Backend tests | 24,791 lines (143% test-to-prod ratio) |
> | Total test assertions | 644 frontend + 2,263 backend = **2,907** |
> | Pages/surfaces | 23 lazy-loaded routes |
> | Backend services | 56 service objects across 14 domain modules |
> | Pundit policies | 30 authorization policies |
> | CI jobs | 4 (frontend typecheck/lint/test/build, backend security, backend RSpec, frontend perf) |
> | Data feeds | 6 real-time ingestion services (ACLED, AIS, FIRMS, GDACS, GPSJam, USGS, OpenSky) |
> | Database migrations | 71 |
> | Tech stack | Rails 8.1, React 19, TypeScript 5.9, MapLibre, CesiumJS, PostgreSQL 17 + PostGIS |
>
> **Current score: 93/100**
>
> ---
>
> ## 2. What's Production-Grade (What Earns the 93)
>
> ### 2.1 Authorization & Multi-Tenancy — Excellent
>
> The `ApplicationPolicy` base class implements a proper tenant-isolation model with org-scoping AND area-of-operation scoping. Key observations:
>
> - **Scope composition is correct.** `site_scope()` chains `organization_id` + `area_of_operation_id` filters. Cross-entity accessibility checks (`signal_rule_match_accessible?`, `incident_accessible?`) correctly traverse the entity graph — match → site → org, match → incident → site → org, match → task → site → org.
> - **`after_action :verify_authorized`** on `BaseController` means Pundit raises if any action forgets to call `authorize`. This is the right pattern — it makes authorization bugs compile-time (deploy-time) errors, not runtime surprises.
> - **30 policies** covering every model. No "god mode" bypasses. Mutations default to commander-only. This is exactly the trust model a defense platform needs.
>
> ### 2.2 Audit Trail & Replay — Staff-Level
>
> The `Audit::EventWriter` is the backbone. Every mutation routes through it — recording `before_snapshot`, `after_snapshot`, `actor`, `correlation_id`, and auto-resolving `organization_id` through entity graph traversal. This is not a logging afterthought — it's an architectural commitment.
>
> `Replay::ProjectionService` reconstructs entity state at any `as_of` timestamp by replaying audit events. The `MAX_EVENTS = 100,000` safety cap, the comment about why `find_each` would break ordering, the explicit "Pure read operation with no side effects" doc — these are signs of someone who understands production safety.
>
> The frontend threads `useReferenceTimeMs` across all time-dependent surfaces. The `as_of` query param is parsed with `InvalidDatetimeParamError` so replay clients can never silently fall back to live data. **This is the single most sophisticated subsystem in the app.**
>
> ### 2.3 Correlation Engine — Production-Correct
>
> `RuleFiringService` uses an atomic transaction with optimistic cooldown locking:
>
> ```ruby
> rows_updated = CorrelationRule
>   .where(id: @rule.id)
>   .where("last_fired_at IS NULL OR last_fired_at <= ?", cooldown_cutoff)
>   .update_all(last_fired_at: Time.current)
> raise CooldownActive if rows_updated == 0
> ```
>
> This is the correct pattern for exactly-once firing under concurrency. The SSE broadcast is explicitly a post-commit side-effect. The `RecordNotUnique` rescue in `IngestService` handles the same race on signal ingestion. **A senior reviewer would recognize these as production-hardened patterns.**
>
> ### 2.4 AI Subsystem — Well-Bounded
>
> The `Recommendations::RuleEngine` is a pure deterministic tier (no LLM) that generates actionable recommendations from operational context. The `LlmEnricher` is a separate tier with its own `CircuitBreaker` (3-failure threshold, 2-minute open window, per-service tracking). The circuit breaker uses Rails cache with a memory-store fallback — correct for single-process dev, and cache-store-agnostic for prod (Redis, Memcached).
>
> The `ScopedRelations` module ensures AI queries respect the same Pundit scopes as the API — no privilege escalation through the AI surface.
>
> ### 2.5 Real-Time Infrastructure — Solid
>
> `PostgresRelay` uses `pg_notify` + `LISTEN` with:
> - Dedicated listener connections (not borrowing from the AR pool)
> - Auto-reconnect on `PG::Error` / `IOError` with 1-second delay
> - `RelayHealthRegistry` for heartbeat tracking
> - `Observability.capture_exception` with throttle keys (60s) to prevent alert floods
> - Named threads for debugging (`signal-broadcast-relay`)
>
> The frontend API client has `AbortController` timeouts (30s default, 120s for PDF), 401 → session cleanup, 429 → user-facing toast. **This is complete.**
>
> ### 2.6 Frontend Architecture — Strong Fundamentals
>
> - **Every page lazy-loaded** with `React.lazy` + `PageErrorBoundary` with embedded `Suspense`. No eager-loading accidents.
> - **Sub-hook decomposition** on the map engine: 9 hooks each owning their own layers. Clean separation of pure lib functions from React side-effects.
> - **API client** is a thin fetch wrapper — no axios, no external dependencies. `credentials: 'include'` for cookie auth, `Authorization: Bearer` supported for API clients. Correct.
> - **Type safety**: Zero `any` escapes. `tsc --noEmit` passes cleanly.
>
> ### 2.7 CI Pipeline — Complete
>
> 4 jobs covering: TypeScript typecheck, ESLint, Vitest, production build, Brakeman security scan, `bundler-audit` CVE check, RSpec with PostGIS-enabled Postgres, and frontend performance benchmarks. Concurrency groups prevent redundant runs. **This is a real CI pipeline, not a checkbox.**
>
> ### 2.8 Test Quality — The Strongest Signal
>
> The test-to-production ratio (54% frontend, 143% backend) is high, but ratios alone are misleading. What matters is what's being tested:
>
> - **Race condition tests** (DebriefPanel monotonic token guard)
> - **Stale-state rejection** (in-flight lookup rejection with generation counters)
> - **Adapter-level map engine tests** (1,794 lines testing paint-order, style-swap persistence, mode-exclusive click routing)
> - **Optimistic locking tests** (correlation rule cooldown claim under concurrency)
> - **Authorization boundary tests** (org-scoped vs. AO-scoped vs. global)
>
> **These aren't "does it render" tests. These are "does it behave correctly under adversarial conditions" tests.** A CTO notices this immediately.
>
> ---
>
> ## 3. What's Missing — The Gap from 93 to 97
>
> ### Gap 1: Globe Is a Second-Class Surface (→ 2 points)
>
> The globe has the rendering engine but none of the operational intelligence:
>
> | Capability | Map | Globe |
> |------------|-----|-------|
> | Evidence-linked highlighting | ✅ | ❌ |
> | Alert triage in context panel | ✅ | ❌ |
> | Freshness rendering on entities | ✅ | ❌ |
> | `referenceTimeMs` threading | ✅ | ❌ |
> | Debrief integration | ✅ | ❌ |
> | Geospatial tools (5) | ✅ | ❌ |
>
> **Why this matters for portfolio:** An evaluator opens the globe, clicks a site, sees nothing — no alerts, no freshness, no evidence chain. They switch to map, see everything. The immediate read is "the 3D view is a demo prop, not a real surface." At Anduril or Palantir, the globe IS the primary operator surface. A globe that can't triage is a liability.
>
> **What closes it:** Evidence highlighting + `referenceTimeMs` on globe (1 slice), alert triage in globe inspector (1 slice). These two alone change the evaluator's perception from "demo" to "dual-surface workstation."
>
> ### Gap 2: No Composable Workstation Layout (→ 1 point)
>
> Map and Debrief are separate pages. An operator must choose: spatial awareness OR temporal awareness. At Palantir, the operator gets both — map on the left, timeline on the right, with cross-panel event routing.
>
> **Why this matters for portfolio:** The split workstation is the visual signature of operator-grade software. It's the difference between "23 pages" and "a workstation." An evaluator who's used Gotham or Lattice will notice.
>
> **What closes it:** This is the 5-slice effort discussed in the audit follow-up. It's real engineering — replay authority, AlertChainDrawer reconciliation, cross-panel navigation, responsive breakpoints. Estimated 5 slices.
>
> ### Gap 3: Date.now() Default Parameters (→ 0.5 points)
>
> 6 library functions use `Date.now()` as default parameters. All callers currently pass the reference time, so no bug exists today. But the defaults mean a new caller that forgets the argument silently breaks replay — and the compiler doesn't catch it.
>
> **Why this matters for portfolio:** An evaluator who greps for `Date.now()` and finds it in `mapSignalRendering.ts:44` — the hot signal render path — will ask "is this replay-safe?" The answer is "yes, because the caller always passes it" — but the question shouldn't need to be asked. Making the params required eliminates the question entirely.
>
> **What closes it:** 30 minutes. Remove 6 defaults, fix 5 callers, add 1 clarifying comment.
>
> ### Gap 4: MapPage Structural Debt (→ 0.5 points)
>
> 845 lines, 29 `useState`, 31 `useCallback`, 65-prop child interface. This is the one place where the code doesn't match the maturity of the rest of the system. It works, but it signals "this grew incrementally and wasn't refactored."
>
> **Why this matters for portfolio:** An evaluator who opens `MapPage.tsx` and sees the 5× toggle mutex duplication (lines 500–564) will think "this engineer ships features fast but doesn't refactor." That's not a deal-breaker, but it's a deduction from a 97.
>
> **What closes it:** `useActiveMapTool` + per-tool hooks (1–2 slices). Only worth doing if a 6th+ tool is planned. At 5 tools, it's ugly but stable.
>
> ---
>
> ## 4. Developer Evaluation
>
> ### What I'd Tell the Hiring Committee
>
> **This is a staff-level project.** Not because of feature count — lots of people build 23-page apps. It's staff-level because of:
>
> 1. **Systems thinking.** The audit trail isn't bolted on — it's the foundation. Every mutation writes through `EventWriter`, every time-dependent surface reads `referenceTimeMs`, every replay query uses `as_of`. This is architectural, not feature-level thinking.
>
> 2. **Concurrency correctness.** The optimistic cooldown lock in `RuleFiringService`, the `RecordNotUnique` rescue in `IngestService`, the monotonic token guard in `DebriefPanel` — these are patterns that only matter under real load. Building them preemptively shows production experience or deep understanding of what goes wrong.
>
> 3. **Trust boundaries.** 30 Pundit policies with `verify_authorized`. The AI subsystem respects scoped relations. The circuit breaker prevents cascade failures. The replay system prevents future-state leakage. These aren't features — they're safety properties.
>
> 4. **Operational awareness.** `RelayHealthRegistry`, `Observability.capture_exception` with throttle keys, `FreshnessState` surfaced in the UI, per-tier performance budgets with CI gates. This person thinks about what happens at 3 AM when the on-call gets paged.
>
> 5. **Execution discipline.** The `memory/execution_handoff.md` is the most rigorous multi-model collaboration artifact I've seen. The "Do Not Reopen" list with 27 completed slices, the "Known Risks" section with explicit scope boundaries — this is how you run a project, not just build one.
>
> ### Honest Weaknesses to Address
>
> 1. **God component tolerance.** MapPage grew from 319 to 845 lines across 5 phases without a refactor. A staff engineer at Palantir would have extracted the tool state at tool 3, not tool 5. The instinct to ship features is correct, but the refactoring trigger should fire earlier.
>
> 2. **Globe parity blindness.** Building 5 map features without raising the globe parity concern earlier suggests either tunnel vision on one surface or undervaluing the 3D workstation. At Anduril, the 3D globe IS the product. Shipping 5 map tools while the globe has zero is a product prioritization gap.
>
> 3. **Default-parameter foot-gun.** Choosing `Date.now()` as a default was a conscious convenience-over-safety tradeoff. It saved typing at the call site. In a codebase with a replay system, safety should win that tradeoff every time. This is a judgment calibration issue, not a skill issue.
>
> These are **coaching points**, not disqualifiers. The baseline is strong.
>
> ---
>
> ## 5. Strategic Roadmap to 97
>
> ### Priority-Ordered by Portfolio Signal
>
> | Priority | Work | Score Impact | Effort | Justification |
> |----------|------|-------------|--------|---------------|
> | **P0** | `Date.now()` defaults → required | +0.5 | 30 min | Eliminates a replay bug class. Zero risk. |
> | **P1** | Globe evidence highlighting + `useReferenceTimeMs` | +1.0 | 1 slice | Highest-visibility parity fix. Changes globe from "demo" to "operational." |
> | **P2** | Globe alert triage in inspector | +1.0 | 1 slice | Completes the globe as a triage surface. Depends on P1. |
> | **P3** | Map + Debrief split workstation | +1.0 | 5 slices | Portfolio differentiator. "Operator workstation" vs "23 pages." |
> | **P4** | MapPage decomposition | +0.5 | 1-2 slices | Code quality signal. Only if tool 6+ is planned. |
>
> **Total: 93 → 97 with P0 through P3.** P4 is insurance, not required for the score.
>
> ### What I Would NOT Build
>
> - **Session persistence for tools.** The handoff explicitly prohibits it. Don't cross that scope boundary without a full design pass.
> - **More geospatial tools.** 5 (soon 6) is enough. Adding more won't move the score — parity and layout will.
> - **Backend API changes.** The backend is production-grade. Don't touch it unless a frontend feature requires it.
> - **More tests.** 2,907 assertions is sufficient. The test quality is already a differentiator. Adding more won't move the needle.
>
> ---
>
> ## 6. Final Assessment
>
> | Dimension | Score | Notes |
> |-----------|-------|-------|
> | Architecture | 95 | Replay + audit trail + multi-tenancy + AI trust boundaries |
> | Code quality | 91 | Excellent everywhere except MapPage god component |
> | Test quality | 96 | Race condition tests, adapter-level engine tests, authorization boundary tests |
> | Security posture | 94 | Pundit + Brakeman + JWT + scope enforcement. No RBAC gaps found. |
> | Operational readiness | 92 | Health registry, circuit breaker, observability. Missing: structured alerting rules, runbook. |
> | Frontend engineering | 93 | Sub-hook decomposition, lazy loading, error boundaries, type safety. Missing: globe parity. |
> | Backend engineering | 95 | Service objects, idempotent ingestion, optimistic locking, cursor pagination. |
> | CI/CD maturity | 93 | 4-job pipeline with perf gates. Missing: staging deploy, E2E smoke tests. |
> | Portfolio signal | 91 | Strong systems work. Globe parity + split workstation would push to 96+. |
>
> **Overall: 93/100. Path to 97 is clear and achievable in ~8 slices.**
>
> ---
>
> ## 7. What Would Make Me Hire This Person
>
> At Palantir, Anduril, or Rune — I'd move this person to an on-site based on this project alone. The replay system, the authorization model, the correlation engine, and the test quality are above the bar. The two things I'd want to see in the interview:
>
> 1. **Can they articulate the replay architecture?** The `useReferenceTimeMs` → `as_of` → `ProjectionService` → `AuditSnapshotService` pipeline is genuinely sophisticated. If they can explain why `Date.now()` is impure in a replay context and how the `referenceTimeMs` threading prevents it — on a whiteboard, without looking at code — that's a staff-level systems answer.
>
> 2. **Can they talk about what they'd do differently?** The MapPage god component, the globe parity gap, the default-parameter choice — these are real mistakes. A staff engineer owns mistakes and explains what they learned. "I prioritized feature velocity over refactoring and here's where the line should have been" is the right answer.

---

## 3. Current Disposition Per Priority

### P0 — `Date.now()` defaults → required parameters — **SHIPPED**

- **Commit:** `368e079`
- **Diff scope:** 12 code files + handoff rotation
- **Changes:**
  - Defaults removed from `buildMapSignalFeatureCollection`, `buildMapSignalRenderCollections` ([frontend/src/lib/mapSignalRendering.ts](frontend/src/lib/mapSignalRendering.ts))
  - Default removed from `timeAgo(iso, nowMs)` ([frontend/src/lib/formatters.ts](frontend/src/lib/formatters.ts))
  - Default removed from `isTelemetryFresh(reading, nowSeconds)` ([frontend/src/lib/telemetry.ts](frontend/src/lib/telemetry.ts))
  - Defaults removed from `buildAssetFeatureCollection` ([frontend/src/lib/mapRenderData.ts](frontend/src/lib/mapRenderData.ts))
  - File-local `staleness()` default removed ([frontend/src/components/EntityCard.tsx](frontend/src/components/EntityCard.tsx))
  - Admin pages route through `useReferenceTimeMs()` instead of implicit wall clock ([frontend/src/pages/OrganizationsPage.tsx](frontend/src/pages/OrganizationsPage.tsx), [frontend/src/pages/UsersPage.tsx](frontend/src/pages/UsersPage.tsx))
  - Live SSE tick hoists `nowSeconds` out of the per-reading loop ([frontend/src/hooks/useTelemetryStream.ts](frontend/src/hooks/useTelemetryStream.ts))
  - Live-only paths (`coverage.ts`, `assetPresentation.ts`, `useMapAssetLayers.ts`) pass an explicit clock at the call site
- **Side effects:** Fixed a latent `react-hooks/purity` violation on admin pages that the prior `Date.now()` default had been hiding.
- **Validation at commit:** 656/656 Vitest, 0 TS errors, ESLint clean on all 13 touched files.
- **Gate verdict:** READY TO COMMIT, no P0/P1/P2/P3 findings.

### P1 — Globe evidence highlighting + `useReferenceTimeMs` threading — **PARTIAL (slices 1–2 shipped)**

- **Slice 1 shipped (`402cd00`):** linked-entity cross-highlighting on globe + `useReferenceTimeMs` threading through `GlobePage → useGlobeEngine → sub-hooks`.
  - `useGlobeSiteEntities` and `useGlobeAssetEntities` apply a blue (#5282ff) 4px outline when the linked-highlight target matches — mirror of map's `site-linked-ring` / `asset-linked-ring` semantics.
  - `GlobePage` routes `asOf` through `useReferenceTimeMs` and passes the clock into the engine (threaded but unused in slice 1; reserved for a future freshness slice).
- **Slice 2 shipped (`d93d897`):** evidence-linked site ring on globe.
  - `useGlobeSiteEntities` extended to three-state outline precedence: linked (blue, 4) > evidence (amber #f5a623, 3) > default (white, 2). Matches map's layer-order contract where `site-linked-ring` paints over `site-evidence-ring`.
  - `GlobePage` calls `useEvidenceLinkedIds(selectedSiteId, selectedSignalId, asOf)` — same arguments `MapPage:188` uses — and threads `evidenceSiteIds` into the engine.
  - Test facade upgraded so color values are preserved through `fromCssColorString`; tests assert on the visual contract (blue vs amber vs white) not just width.
- **Follow-up shipped (`19c37e0`):** freshness-driven fill alpha on globe asset entities. Same curve as `useMapAssetLayers`'s circle-opacity (fresh 0.94 / aging 0.72 / stale 0.46 / unavailable 0.32). `ASSET_FRESHNESS_THRESHOLDS` hoisted to `freshness.ts` so both surfaces consume one source of truth. Consumes the `referenceTimeMs` plumbing from slice 1, eliminating the speculative `_referenceTimeMs: void` placeholder.
- **Follow-up shipped (`e2171e5`):** signal-side evidence outline on globe `PointPrimitive`s (amber `#f5a623` @ alpha 0.9 for evidence-linked, per-signal-type base @ alpha 0.35 for default). Mirrors `useMapSignalLayers:159-181`. `evidenceSignalIds` (already emitted by `useEvidenceLinkedIds`) was destructured-and-discarded at slice 2; now threaded through. Both halves of the evidence-highlight pairing — sites when a signal is selected, signals when a site is selected — are live on globe.
- Step 0 verifications confirmed all gaps were real at pre-slice HEAD.
- **P1 parity is fully closed** with this follow-up. No further P1 work is currently scoped.

### P2 — Globe alert triage in inspector — **SHIPPED (`23a722d`)**

- Inline-rendered `MapSiteAlertsSection` inside `GlobeInspectorPanel` when a site is selected, mirroring the MapSitePanel placement.
- New GlobeInspectorPanel props (`referenceTimeMs`, `canTriage`, `onSelectSignal`) are a pass-through to the alerts section — no map-specific coupling to untangle.
- GlobePage threads `useRole().canTriageAlerts`; role gating + replay null-render are inherited from the section's own discipline.
- Step 0 confirmed the claim: pre-slice globe inspector had zero alert / SignalRuleMatch / ack / escalate code paths. Claim was accurate, slice stayed narrow.
- Component rename `MapSiteAlertsSection → SiteAlertsSection` deliberately deferred — touches 5 callers and adds no functional value; documented in-comment at the import site.

### P3 — Map + Debrief split workstation — **OPEN**

- Claimed scope: 5 slices.
- Claimed justification: "Operator workstation vs 23 pages."
- Status: not yet started.
- For Codex to evaluate — see §4.

### P4 — MapPage decomposition — **OPEN, conditional**

- Claimed scope: 1–2 slices.
- Claimed condition: "Only if tool 6+ is planned."
- Status: not yet started; no 6th tool currently planned in the execution package.
- For Codex to evaluate — see §4.

---

## 4. Open Items For Codex — Evaluate Before Adopting

Claude has not pre-judged P1–P4. Before shipping any of them, Codex (or Claude) should run the following verifications against current code and decide whether the claim holds up or needs adjustment.

### Evaluating P1 — Globe evidence highlighting + `referenceTimeMs` threading

**Claim:** Globe has no evidence-linked highlighting, no freshness rendering, no `referenceTimeMs` threading. Map has all three. Closing this parity is 1 slice.

**Verify:**
1. `frontend/src/pages/GlobePage.tsx` and the globe engine hooks under `frontend/src/hooks/globe/` — do they consume `useReferenceTimeMs` anywhere? Do the globe source builders accept a reference clock?
2. `frontend/src/lib/globe*` (or whatever the globe-side analog of `mapRenderData.ts` / `mapSignalRendering.ts` is) — do they already thread a clock internally, or do they fall back to `Date.now()` implicitly?
3. Is the evidence-linked highlighting model in map (`linkedSiteId` filter on `asset-linked-ring` in `useMapAssetLayers.ts:106-121`, and the parallel map signal highlight code) directly translatable to Cesium entity highlighting, or does the 3D renderer need a different approach?
4. Is there a globe inspector panel at all today? If not, the 1-slice claim may be optimistic — it might implicitly require the inspector scaffolding too.

**Decision frame:**
- If current globe has zero freshness and zero highlight: the claim is accurate; this is a high-value slice.
- If globe already has partial parity: scope the slice to the actual delta, not the claim.
- If Cesium requires a materially different highlighting strategy than MapLibre: split into a scoped spike first before committing to "1 slice."

### Evaluating P2 — Globe alert triage in inspector

**Claim:** Globe inspector has no alert triage. Add it in 1 slice after P1 lands.

**Verify:**
1. What does the globe's current selection/inspector surface show? Is it a full panel, a tooltip, or nothing?
2. Map's triage surface — where exactly does it render (likely `MapPage` context panel or a `TriagePanel` child)? How coupled is it to map-specific props vs. entity-agnostic data?
3. Is the alert data fetch path (signal rule matches + alerts queries) already generalized enough to drop into a globe consumer, or does it assume the map page's state shape?

**Decision frame:**
- If the triage panel is already a reusable component consuming pure data props, P2 is genuinely small.
- If it is tightly wired to map-specific context, this is closer to a refactor + port rather than a drop-in.
- Reject P2 as "1 slice" if Codex finds map-specific coupling that wasn't accounted for.

### Evaluating P3 — Map + Debrief split workstation

**Claim:** Combining map (spatial) and debrief (temporal) on one screen with cross-panel event routing is the "operator workstation" signature. 5 slices.

**Verify:**
1. Is this genuinely valuable to an operator, or is it a visual aesthetics claim? The report itself calls it "the visual signature of operator-grade software" — that framing is portfolio-driven, not user-driven.
2. What's the replay authority story when two panels are on one screen? Today `useReferenceTimeMs` comes from the URL `as_of` param per page. A split workstation needs a single source of truth or explicit cross-panel coordination. This is the "replay authority" risk the report acknowledges.
3. What does `AlertChainDrawer` currently own, and how would reconciling it across two mounted panels actually work? Check `frontend/src/components/AlertChainDrawer*`.
4. Is there responsive-breakpoint infrastructure today, or would the split layout force introducing one?
5. Risk: this is the largest proposed item (5 slices) and the one most likely to churn — confirm it's worth the ratio before starting.

**Decision frame:**
- If the operator-value story is real (not just portfolio aesthetics) and the replay-authority model is designable in ≤1 slice of upfront design, P3 is worth it.
- If it's primarily portfolio-driven and would compromise replay authority, defer or reject.
- Consider a reduced scope: "Debrief panel inline on map page, no independent replay" — cheaper and proves the pattern without the full workstation commitment.

### Evaluating P4 — MapPage decomposition

**Claim:** MapPage is 845 lines with 29 `useState`, 31 `useCallback`, 65-prop child interface, 5× toggle mutex duplication at lines 500–564. Only decompose if a 6th tool is planned.

**Verify:**
1. Confirm the line count and mutex duplication are still accurate at current HEAD — the report was written at `823dd05` + uncommitted 7-1E; there have been further slices.
2. Is a 6th tool actually planned? Per the execution package's current state, Phase 7 is closed and there is no 6th tool on deck. That makes P4's own "only if" condition currently false.
3. Is the 65-prop child interface actually causing bugs, or just aesthetically noisy? If it's stable and well-tested (which the adapter-level engine tests suggest), the cost-benefit tilts away from refactoring.

**Decision frame:**
- If no 6th tool is planned and the existing tests pin behavior: defer P4 as low-priority code quality rather than a roadmap item.
- If a 6th tool does land or MapPage starts generating bugs: revisit — the `useActiveMapTool` extraction the report proposes is the right shape.

---

## 5. Non-Obvious Context Codex Should Know

These are things Claude learned while shipping P0 that aren't obvious from just reading the report:

1. **`Date.now()` inline in render is a lint error, not just a style issue.** `react-hooks/purity` blocks it. The hook `useReferenceTimeMs(asOf?)` — returns `asOf` when set, otherwise a pure live clock refreshed on a 60s interval inside `useEffect` — is the established repo pattern. Any new surface that needs a clock should use this hook, not `Date.now()` directly. Examples already in-tree: [EntityCard.tsx:258](frontend/src/components/EntityCard.tsx#L258), [SiteTimeline](frontend/src/components/SiteTimeline.tsx), map/globe surfaces.

2. **Live-vs-replay branch separation is enforced by call-site discipline, not by types.** After P0, library functions take a required `referenceTimeMs`, but nothing stops a caller from passing `Date.now()` in a replay-gated branch. The safety comes from the branch structure (e.g., `options.allowHistorical` short-circuit in `assetPresentation`). P1 should preserve this discipline on globe — pick the clock at the edge based on replay state, not inside the renderer.

3. **The execution package (`memory/execution_context.md` + `memory/execution_handoff.md`) is the source of truth for active work.** Legacy roadmap docs (`memory/project_roadmap.md`, `memory/project_production_readiness_plan.md`) may conflict — prefer the execution package. Update it after any adopted priority lands.

4. **Do Not Reopen list is load-bearing.** The handoff's "Do Not Reopen" section names 27 shipped slices; re-touching any of them needs explicit justification. P1–P4 are new work, not re-openings.

5. **Session persistence for map tools is explicitly prohibited.** The report itself repeats this. If any proposed slice creates pressure to persist tool state, push back — that's a separate design discussion.

---

## 6. Decision Framework For Next Action

When either model picks up, the question is not "what's next to ship?" — it's:

1. **Is P1 actually 1 slice?** Read the globe page + hooks. If yes, propose the slice. If the delta is larger, scope it honestly before committing.
2. **Does the operator-value story justify P3's 5 slices?** This is the biggest commitment — do not start without alignment with the user on whether portfolio signal alone justifies it.
3. **Is there a 6th tool on deck?** If not, do not start P4; treat it as deferred code quality.

If the above are all "not yet," the coherent stopping point is: P0 shipped, P1 is the next candidate pending a scoping check, nothing else is authorized to start.
