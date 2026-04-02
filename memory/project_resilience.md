---
name: project_resilience
description: Full stack, architecture, domain models, feature status
type: project
---

# Resilience — Project Memory

Companion files:
- `memory/project_roadmap.md` — current implementation order and next major tracks
- `memory/project_open_findings.md` — unresolved engineering debt and architecture programs

When memory conflicts with code, prefer code. This file is the stable project snapshot; active sequencing and open debt now live in the companion files above.

## Stack

- **Backend:** Ruby on Rails (API mode), PostgreSQL, SolidQueue recurring/background jobs, SSE for real-time push
- **Frontend:** React + TypeScript, Vite, Blueprint UI, CesiumJS, MapLibre GL
- **Deployment:** Fly.io (backend + postgres), Vite dev server locally
- **Testing:** RSpec (backend), ESLint + TypeScript build validation (frontend)

---

## Domain Model

### Core Entities

- **Site** — a monitored geographic area or facility. Has status (active/inactive), flagged state, audit trail.
- **Vessel** — first-class AIS entity. Fields: mmsi (unique), name, vessel_type, flag, destination, lat, lng, speed, heading, first_seen_at, last_seen_at, last_signal_id (FK to external_signals), loitering_since.
- **ExternalSignal** (external_signals table) — raw inbound sensor/feed data. Separate from entity state.
- **SignalRule** — user-defined rule that matches on signal properties. Supports single and compound AND/OR conditions.
- **SignalRuleMatch** — recorded fire when a rule matches a signal. Includes workflow state and confidence scoring.
- **Task** — actionable work item associated with a site. Has title, description, priority.
- **AuditEvent** — append-only audit trail for site actions.

### Ontology Mindset (architectural principle)
Every new entity must answer: "Is this an entity, a property, a relationship, or an event?"
- Vessels are first-class entities (not just signal sources)
- Raw sensor data (external_signals) is separate from entity state (vessels)

---

## Services

- **AisIngestionService** — ingests AIS pings, creates ExternalSignal, calls Vessel.upsert_from_signal!. Lives in `feeds/` namespace to preserve SRP.
- **IngestService** — generic ingestion coordinator.
- **EvaluatorService** — evaluates SignalRules against incoming signals, including compound AND/OR conditions.
- **Tasks::UpdateService** — needs string-keyed params, not symbol keys (known quirk). Accepts `actor_role:` keyword ("commander" / "operator"); operators are restricted to title+description only; priority is commander authority. Correlation engine passes `actor_role: "commander"` for automated escalations.

---

## Key Files

| Path | Purpose |
|------|---------|
| backend/app/models/vessel.rb | Vessel model, upsert_from_signal! class method, scopes |
| backend/app/services/feeds/ais_ingestion_service.rb | AIS ingestion + vessel upsert wiring |
| backend/db/migrate/20260318030000_create_vessels.rb | vessels table migration |
| backend/spec/models/vessel_spec.rb | 23 RSpec examples for Vessel |
| backend/spec/factories/vessels.rb | FactoryBot factory for Vessel |
| backend/spec/services/feeds/ais_ingestion_service_spec.rb | 29 RSpec examples for AisIngestionService |
| backend/db/migrate/20260318030001_create_vessel_tracks.rb | vessel_tracks table migration (append-only, no updated_at) |
| backend/app/models/vessel_track.rb | VesselTrack model — append-only guard, between/older_than scopes |
| backend/app/jobs/vessels/track_retention_job.rb | Batched daily retention deletion (BATCH_SIZE=1000) |
| backend/spec/models/vessel_track_spec.rb | RSpec examples for VesselTrack |
| backend/spec/jobs/vessels/track_retention_job_spec.rb | RSpec examples for TrackRetentionJob |
| backend/spec/factories/vessel_tracks.rb | FactoryBot factory for VesselTrack |
| frontend/src/pages/GlobePage.tsx | Cesium globe, replay-aware signals, entity picking, inspector panel |
| frontend/src/pages/MapPage.tsx | MapLibre operational map, vessel tracks, signal/site/asset panels |
| frontend/src/hooks/useSignals.ts | Signal query hook with configurable refetch interval |
| frontend/src/hooks/useTelemetryStream.ts | SSE asset telemetry stream with token exchange + reconnect |

---

## Feature Status

### Shipped / Production

- Signal feed with pagination (50 per page, prev/next controls)
- Site detail page (/sites/:id) — tabs: tasks, signals, rule fires, assets, audit
- Create task from site detail page (dialog: title, description, priority)
- Site status toggle (activate/deactivate) with audit trail — PATCH /api/sites/:id/toggle_status (commander-only)
- Unflag site action with audit trail — PATCH /api/sites/:id/unflag (commander-only)
- Real-time toasts for rule fires, task creation, and transitions (SSE-backed)
- Security fix: serialize-javascript CVE patched via yarn resolutions
- Atomic cooldown claim (prevents concurrent rule-fire race condition)
- Auth guards, error propagation, type safety, dry-run error display
- 3D Cesium globe with AO polygons, live asset telemetry, replay-aware signal cutoffs, and direct inspection for sites/assets/signals
- Globe inspector supports asset telemetry, signal metadata, and maritime vessel enrichment for vessel-position signals
- `/api/signals` now treats `as_of` as a first-class upper bound; if both `to` and `as_of` are supplied, the earlier timestamp wins

### Phase 1 — Intelligence Layer (COMPLETE)

**Step 1 — vessels table** (DONE, committed: af36c08)
**Step 2 — Wire vessel upsert into AIS ingestion** (DONE, committed: 6fe6352)
**Step 3 — vessel_tracks table + retention job** (DONE, committed: b7e2323)
**Step 4 — AIS gap detection job** (DONE)
- Vessels::GapDetectionJob synthesizes ais_gap derived signals when vessel unseen > 20 min
- Confidence scoring: base 0.50, +0.25 if speed ≥ 5kn, -0.20 if speed < 1kn, +0.20 if inside high-threat AO polygon
- External ID = "gap_#{mmsi}_#{last_seen_at.to_i}" for idempotency; occurred_at anchored to last_seen_at
- 9 RSpec examples, all passing

**Step 5 — Compound rule conditions** (DONE)
- CorrelationRule: VALID_OPERATORS = %w[AND OR], compound? predicate, normalized_conditions coercion
- Validation: compound rules require ≥ 2 sub-conditions; validates each sub-condition
- CorrelationRule spec: 12 examples covering legacy and compound AND/OR validation

**Step 6 — Update EvaluatorService for compound conditions** (DONE)
- EvaluatorService always calls normalized_conditions → never special-cases format
- Direct path: signal_type matches → proximity + magnitude + count checks
- Corroboration path: signal_type differs → query DB for recent nearby signals of that type
- Operator AND: results.all? | OR: results.any?
- EvaluatorService spec: 23 examples; haversine math, full AND/OR integration tests

**Step 7 — Confidence scoring on SignalRuleMatch** (DONE)
- confidence double precision column on signal_rule_matches (indexed)
- RuleFiringService#compute_confidence: AND→mean of sub-scores, OR→max of sub-scores
- proximity_confidence: 1.0 at site, 0.0 at boundary; corroboration_confidence: avg(proximity, freshness)
- RuleFiringService spec: 391 lines, confidence scoring coverage included

**Step 8 — Alert acknowledgment workflow** (DONE)
- SignalRuleMatch: 4-state machine (unacknowledged→acknowledged→investigating→closed)
- Alerts::TransitionService: validates transition, records acknowledged_by + acknowledged_at + notes, SSE broadcast
- signal_rule_matches_controller.rb: transition, bulk_transition (max 100), allowed_transitions endpoints

**Step 9 — Enriched SSE payloads + toasts** (DONE)
- rule_fired SSE payload includes confidence, workflow_status, distance_km, actions_taken
- alert_transitioned SSE event broadcast after every transition

**Step 10 — Compound rule builder UI** (DONE)
- CorrelationRulesPage.tsx (52KB): create/edit rules with AND/OR compound conditions
- AlertTriagePage.tsx: full triage UI with ALERT_TRANSITIONS state machine, bulk actions, filtering
- Frontend types: CompoundConditions, RuleConditions, isCompoundRule type guard

---

## Roadmap (v2+ plan)

| Phase | Focus |
|-------|-------|
| Phase 1 | Intelligent correlation (vessels, gap detection, compound rules, confidence, alert ACK) |
| Phase 2 | Maritime operational depth (loitering, chokepoints, SALUTE, PACE, commander intent, keyboard palette) |
| Phase 3 | Visual intelligence (track trails, heatmap, swimlane viz, globe playback) |
| Phase 4 | Command polish (virtual rendering, risk score, benchmarks, auto-deploy) |

### Roadmap Reality Check (2026-03-29)

- **Phase 1** is complete and hardened.
- **Phase 2** is functionally complete at the CRUD/workflow layer:
  - loitering is shipped
  - chokepoints are shipped in planning/backend workflows
  - chokepoint geographic overlays are now shipped on map and globe
  - SALUTE / PACE / commander intent are shipped
  - keyboard command palette is shipped
- **Phase 2 adjunct closeout is complete:** chokepoints are now spatially visible on both MapPage and GlobePage, so the doctrine/planning workflow is no longer isolated from the operational surfaces.
- **Phase 3** is complete for the current canonical v1 scope:
  - selected-vessel track trails are shipped on map and globe
  - map heatmap is shipped
  - swimlane visualization is shipped as a dedicated live-only page backed by `/api/analytics/swimlane`
  - replay transport controls are shipped: play/pause, step-forward/step-backward (5 min), speed selector (1×/5×/15×/60×), auto-advance timer, and clear-to-live
  - replay state machine lives in `ReplayContext.tsx` + `replayTransport.ts`; UI in `ReplaySelector.tsx`
  - replay-aware selected-vessel trail queries are wired on both MapPage and GlobePage via `to=asOf` track windows
  - many live-control-plane surfaces remain intentionally unavailable during replay (AO overlays, chokepoints, breach rings, SSE polling, risk scores, telemetry freeze-point), but that is no longer a Phase 3 blocker
- **Phase 4** is complete for the canonical v1 roadmap:
  - risk scores are shipped
  - CI + auto-deploy to Fly are shipped
  - virtualization exists in the signal feed and alert triage feed
  - globe benchmarking/perf instrumentation exists and the focused-to-global reconcile benchmark is budgeted in Playwright + CI
  - the remaining bounded list/table pages were audited and do not currently justify blanket virtualization
  - the Dockerized production-style boot path is closed by explicit local `CORS_ORIGINS` defaults in `compose.yml`

### Roadmap Clarifications

#### Phase 2 closeout adjuncts

- **Chokepoint geographic overlays**
  - Shipped on MapPage and GlobePage.
  - Rendered as non-primary spatial overlays with legend/toggle support.
  - On the globe, chokepoint ellipses intentionally behave as passthrough overlays rather than first-class selectable entities.
  - This adjunct is now closed and should not remain in the required completion track.

#### Phase 3 closeout specifics

- **Track trails**
  - Current implementation is selected-vessel trail rendering on map and globe.
  - Replay integration is shipped for selected-vessel trails via replay-aware `to=asOf` track queries.
  - Broader asset trail playback remains a future enhancement, not a current v1 blocker.
- **Heatmap**
  - Map heatmap is shipped.
  - Globe heatmap parity is now shipped on the promoted expansion track.
  - Cesium parity uses an aggregated signal-density overlay with its own `HEATMAP` toggle and density legend, gated behind the existing signal visibility control and hidden at close-range tactical zoom.
- **Swimlane visualization**
  - Shipped as a dedicated live-only `/swimlane` page.
  - Backed by `Analytics::SwimlaneService`, which aggregates the existing `Sites::TimelineService` event model into per-site lanes.
  - Supports lookback and event-kind filters, site lane ranking, and SSE invalidation for rule/task/site changes.
- **Globe playback / replay**
  - Transport controls are shipped: play/pause, step ±5 min, speed selector, auto-advance timer, clear-to-live.
  - Replay correctly gates live-only surfaces off during playback.
  - Selected-vessel trails remain available during replay on both MapPage and GlobePage.
  - Remaining “next level” work here is broader asset trail playback, not a current canonical blocker.

#### Phase 4 closeout specifics

- **Virtual rendering**
  - Signal feed is virtualized.
  - Alert triage is virtualized as a bounded scroll surface over the loaded infinite-query pages, preserving bulk actions and load-more behavior while capping live DOM growth.
  - Other potentially large tables/surfaces should be virtualized only if measured pressure justifies it.
  - Current Phase 4 audit result: the remaining list/table pages are mostly bounded at 50-100 rows and do not justify blanket virtualization at current scale.
- **Benchmarks**
  - Globe benchmark coverage exists and now enforces explicit release budgets on the focused-to-global reconcile path.
  - CI runs the Dockerized app and fails if the benchmark breaches its budget.
  - Broader budgets/guardrails beyond the globe benchmark are optional future hardening, not a canonical v1 blocker.
- **Auto-deploy**
  - Already implemented through GitHub Actions + Fly deploy on main after green checks.
- **Operational closeout**
  - `compose.yml` now provides local production-style `CORS_ORIGINS` defaults so Docker/CI boot does not abort before the benchmark path becomes ready.

### Promoted Expansion Track (2026-03-30)

Canonical v1 is complete. The user has explicitly promoted the following former post-v1 items into the active roadmap, in this order:

1. **Kill-chain / prosecution workflow**
2. **Cross-entity natural-language ontology query**
3. **Globe heatmap parity**
4. **Playback-grade multi-asset trails** (defined next on 2026-03-30 after SSE/thread scaling hardening closed)

These are no longer “ignore for now” items for future agents; they are the next build track after canonical v1 closeout.

### Former Post-v1 Candidate Expansions

- **Kill-chain / prosecution workflow**
  - Not part of the original canonical 4-phase roadmap.
  - Now explicitly promoted by the user as the next active build item.
- **Cross-entity natural-language ontology query**
  - Not part of the original canonical 4-phase roadmap.
  - Now shipped as a commander-only `/ontology` page backed by `POST /api/ai/ontology_query`.
  - Uses Anthropic tool-use to translate one named root entity plus relation focus into a bounded graph traversal over the existing incident/site/task/asset/area graph.
  - Returns normalized query metadata, nodes, edges, and deterministic counts/summary rather than inventing a second graph engine.
- **Globe heatmap parity**
  - Not part of the original canonical Phase 3 closeout bar.
  - Now shipped after kill-chain and cross-entity ontology query.

### Locked Finish Plan (2026-03-29)

Future agents should treat this as the current required completion sequence unless the user explicitly changes roadmap scope.

If any external summary, audit, or delegated-agent note disagrees with this section, prefer this section unless the codebase itself has changed and been re-verified.

#### Canonical completion track

- **Canonical v1 is complete** through Phase 4.
- Future agents should not reopen Phase 1–4 unless the code regresses or the user explicitly expands scope.

#### Promoted next-build track

1. ~~**Kill-chain / prosecution workflow**~~ — **SHIPPED (2026-03-29)**
2. ~~**Cross-entity natural-language ontology query**~~ — **SHIPPED (2026-03-29)**
3. ~~**Globe heatmap parity**~~ — **SHIPPED (2026-03-30)**
4. ~~**Playback-grade multi-asset trails**~~ — **SHIPPED**
   - Current active sequencing moved on to platform hardening and replay/security maturity work.
   - See `memory/project_roadmap.md` for the current next-build order.

#### Recently closed

- **Kill-chain / prosecution workflow** (shipped 2026-03-29)
  - `prosecution_phase` column on `Incident` (assessing → executing → concluded, forward-only, orthogonal to status)
  - `ProsecutionStep` model — append-only (before_update throws :abort), UUID PK, evidence_refs JSONB with schema validation
  - `Incidents::ProsecutionService` — `:initiate` and `:add_step` operations; transaction-wraps save + step + Audit::EventWriter; SSE broadcast post-commit
  - 3 new routes: `POST prosecute`, `GET prosecution_steps`, `POST prosecution_steps` (all commander-gated except GET)
  - `ProsecutionPanel.tsx` — PhaseTrack stepper, non-prosecuted/active/concluded states, add-step form, step timeline
  - 7th tab "Prosecution" + phase badge in `IncidentDetailPage.tsx`
  - SSE events: `prosecution_started` and `prosecution_step_added` invalidate queries + show toast
  - 997 RSpec (43 new), 252 Vitest (10 new), 0 TS errors, 0 ESLint errors

- **Cross-entity natural-language ontology query** (shipped 2026-03-29)
  - Commander-only `/ontology` route and sidebar entry.
  - Backend endpoint: `POST /api/ai/ontology_query`.
  - `Ai::OntologyQueryService` uses Anthropic tool-use to translate one named root entity (`site`, `incident`, `task`, `asset`, or `area_of_operation`) plus requested relations into a bounded graph query.
  - Execution stays deterministic and reuses the existing domain model: sites, areas, incidents, alerts, tasks, assets, signals, recommendations, and prosecution steps.
  - Response shape includes normalized query metadata, summary text, node/edge graph data, and by-type counts.
  - Frontend `OntologyQueryPanel.tsx` renders query controls, replay fail-closed behavior, grouped node results, and relationship edges.
  - Post-ship hardening closed the real ontology gaps: consistent time-window enforcement, relation-isolation enforcement, asset-root recommendation traversal fix, explicit Anthropic timeout with zero retries, failure logging + observability capture, 60s catalog caching, `Site.active` root resolution, singular `asset` relation typing, and direct task-root + area-root proof.
  - Verification after hardening: 1046 RSpec, 260 Vitest, 0 TypeScript errors, frontend lint passed, frontend build passed.

- **Globe heatmap parity** (shipped 2026-03-30)
  - GlobePage now mirrors the map-level heatmap UX with an independent `HEATMAP` toggle and a density legend that only appears while signals are enabled.
  - `useGlobeEngine.ts` renders a bounded Cesium signal-density overlay from aggregated heatmap cells rather than raw per-signal blobs.
  - Heatmap overlays are passthrough-only in pick resolution (`heatmap-*` does not steal site/asset/signal selection).
  - Close-range globe inspection still suppresses signal overlays, so the heatmap remains an operational/global layer rather than a tactical close-zoom layer.
  - Validation for this slice: 268 Vitest, frontend lint passed, frontend build passed, `git diff --check` passed.

- **SSE/thread scaling hardening** (shipped 2026-03-30)
  - Added DB-backed `SseStreamLease` admission control so active live streams are capped across Puma workers instead of only being limited by per-process thread starvation.
  - Default live-stream caps are now bounded per user and per remote IP (`SSE_MAX_STREAMS_PER_USER`, `SSE_MAX_STREAMS_PER_IP`) with lease refresh on heartbeat and deterministic release on disconnect.
  - `/api/events`, `/api/signals/stream`, and `/api/telemetry/stream` now reject excess concurrent live streams with `429` before opening the long-lived SSE response.
  - `Rack::Attack` now throttles `POST /api/sse_token` and repeated SSE stream opens to blunt reconnect storms before they consume Puma threads.
  - Validation for this slice: focused SSE proof 37 RSpec, full backend 1058 RSpec, Brakeman 0 warnings, `git diff --check` passed.

- **Pundit auth-layer finish + portable backend test config** (shipped 2026-04-02)
  - Finished the in-progress API authorization migration so the previously skipped controllers now perform explicit Pundit authorization instead of bypassing `verify_authorized`.
  - Added focused policies for AI, analytics, assets, audit-log access, chokepoints, commander intent, feed health, operational health, PACE, readiness, risk scores, SALUTE, signals, SSE token minting, telemetry, and vessels.
  - Preserved the intentional audit-log split: entity-scoped audit history remains available to any authenticated user, while the global audit log stays commander-only.
  - Live endpoints (`signals`, `telemetry`) now authorize before early validation returns, so invalid-request paths still satisfy `verify_authorized`.
  - Added direct request proof for `POST /api/signals`, covering unauthenticated, operator-forbidden, commander-success, and ingest-failure paths.
  - `backend/config/database.yml` no longer hardcodes a workstation-specific test port; it now respects `TEST_DATABASE_PORT` / `DATABASE_PORT`.
  - Validation for this slice: focused auth request proof 143 RSpec, full backend 1102 RSpec, Brakeman 0 warnings, `git diff --check` passed.

- **AI service hardening parity** (shipped 2026-04-02)
  - `Ai::FilterService` and `Ai::SignalFilterService` now match the hardened ontology-query service bar with explicit Anthropic timeout, zero retries, env-overridable models, 60s cached site catalogs, and failure logging + observability capture.
  - `Ai::SummaryService` now has explicit Anthropic timeout, zero retries, env-overridable model selection, and failure logging + observability capture.
  - Summary signal retrieval no longer relies on a bounded `limit * 2` heuristic under the non-PostGIS fallback; it now scans ordered bounding-box candidates until it finds the exact-radius matches needed to satisfy the response limit or exhausts the candidate set.
  - Added direct service proof for both filter services, extended summary proof for timeout handling, model override, observability capture, and exhaustive exact-radius retrieval, and added commander success/failure request proof for `GET /api/ai/filter` in both task and signal modes.
  - Validation for this slice: focused AI proof 61 RSpec, full backend 1125 RSpec, Brakeman 0 warnings, `git diff --check` passed.

- **Current hardening tranche** (2026-04-02)
  - Replay parity expanded for historical briefing generation and historical swimlane windows.
  - Telemetry simulator now requires explicit `TELEMETRY_SIMULATOR_ENABLED=true`.
  - `Recommendations::LlmEnricher` now matches the hardened Anthropic pattern (timeout, zero retries, env model override, observability).
  - AIS gap confidence now uses exact GeoJSON polygon containment for high-threat AO scoring instead of a bounding-box approximation.
  - PostgreSQL relay listeners now publish explicit relay-health heartbeat/error snapshots into `OperationalStatus`.
  - Anthropic-backed services now share a circuit-breaker layer.
  - Logout now revokes the current JWT by `jti`, and revoked tokens can no longer authenticate.

- **Chokepoint geographic overlays**
  - Shipped on both MapPage and GlobePage.
  - Status-colored fill + dashed stroke on MapLibre; ellipse entities on Cesium.
  - Globe pick resolver treats `chokepoint-*` as passthrough overlays (not selectable entities).
  - Viewer cleanup correctly captures and clears `chokepointEntitiesRef` on unmount.
  - The real chokepoint status enum remains:
    - `monitor`
    - `constrained`
    - `contested`
    - `closed`
  - Do not invent alternate labels like `open`, `clear`, or `monitored`.

- **Replay transport controls**
  - `ReplayContext.tsx`: `isPlaying`, `playbackRate`, `play`, `pause`, `setPlaybackRate`, `stepForward`, `stepBackward`.
  - `replayTransport.ts`: `PLAYBACK_RATES = [1, 5, 15, 60]`, `REPLAY_STEP_MINUTES = 5`, `TICK_MS = 500`.
  - `ReplaySelector.tsx`: full transport UI gated on `isReplaying`.
  - Auto-advance formula: `playbackRate × TICK_MS × 60` ms per tick (correct; at rate=1: 30 s simulated per 500 ms real).
  - `stepForward` caps at 1 second before now.
  - `setAsOf` always pauses playback when called.

- **Replay trail integration**
  - `Api::VesselsController#tracks` now supports replay-safe `to` windows and returns the most recent limited slice in chronological order.
  - MapPage and GlobePage keep selected-vessel trails visible during replay while hiding live vessel enrichment.

- **Swimlane visualization**
  - Live-only `/swimlane` page shipped.
  - Backend aggregate endpoint: `GET /api/analytics/swimlane`.
  - Frontend filters: lookback window and event-kind toggles.
  - Uses the existing site timeline event model rather than inventing a parallel event taxonomy.

- **Production-hardening live-stream + ops visibility slice** (shipped 2026-03-29)
  - `Sse::Broadcaster`, `Signals::Broadcaster`, and `Telemetry::Broadcaster` now relay across processes via PostgreSQL `LISTEN` / `NOTIFY`, so live streams are no longer limited to a single in-process subscriber island.
  - Telemetry publishing no longer depends on local subscriber count; remote-only subscribers still receive simulator updates.
  - Feed health snapshots are DB-backed through `OperationalStatus` instead of the old process-local in-memory registry.
  - Commander-only `GET /api/operational_health` exposes DB-backed operational status snapshots.
  - `Telemetry::PreparePartitionsJob` now records success/failure operational status, including the partition-window exhaustion date.
  - `Recommendations::GenerationJob` now uses a PostgreSQL advisory lock to skip overlapping recurring runs and records success / skipped / error status snapshots.
  - Full backend after this slice: 1018 RSpec, 0 failures.

- **Observability / Sentry slice** (shipped 2026-03-29)
  - Backend now supports env-gated Sentry via `sentry-ruby` + `sentry-rails`.
  - Frontend now supports env-gated Sentry via `@sentry/react`, wired through React 19 root uncaught-error handling and `PageErrorBoundary`.
  - Vite source-map upload is wired behind build-time env gating (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) so local/CI builds stay green when Sentry upload credentials are absent.
  - Docker/compose now distinguish runtime Rails Sentry env (`SENTRY_DSN`) from build-time browser Sentry env (`VITE_SENTRY_DSN` plus optional upload credentials).
  - Long-lived infra loops now report throttled exceptions/messages through the new `Observability` helper for relay failures, SSE heartbeat failures, telemetry simulator failures, feed ingestion critical states, and correlation-evaluator critical states.

#### Explicit non-goals for canonical v1 closeout

- Do **not** rebuild map heatmap from scratch; it is already shipped.
- Canonical v1 should not be reopened over globe heatmap parity, kill-chain/prosecution, or cross-entity NL ontology query.
- Those items now belong to the promoted expansion track above, not the canonical closeout bar.

#### Sequence lock

- The active implementation order is:
  1. ~~Kill-chain / prosecution workflow~~ — SHIPPED
  2. ~~Cross-entity natural-language ontology query~~ — SHIPPED
  3. ~~Globe heatmap parity~~ — SHIPPED
  4. Intervening platform hardening detour: Pundit auth-layer finish — SHIPPED
  5. Intervening platform hardening detour: AI service hardening parity — SHIPPED
  6. Playback-grade multi-asset trails — SHIPPED
  7. See `memory/project_roadmap.md` for the current post-trails hardening order

#### Expected remaining canonical phases

- **Phase 3** is complete for the current canonical v1 scope.
- **Phase 4** is complete.
- Phase 2 is functionally complete, and the chokepoint overlay adjunct is now closed.
- No canonical phases remain open.

#### Remaining production-hardening debt (non-roadmap blocker)

- Cross-process live streams and basic ops health visibility are now closed.
- External error tracking is now integrated through env-gated Sentry on backend and frontend.
- SSE/thread scaling safeguards are now closed for the current deployment target through active-stream admission caps plus reconnect throttling.
- The remaining architectural ceiling is still thread-per-connection SSE itself; replacing that transport is a future scale project, not an agreed near-term blocker.

---

## Architectural Decisions

1. Fusion layer lives INSIDE the existing correlation engine (extended schema), not a separate engine.
2. AIS gap detection uses a periodic background job (Vessels::GapDetectionJob) that synthesizes ais_gap signals — these flow through the existing correlation engine unchanged.
3. Compound rule conditions: extend JSONB conditions schema with operator: AND/OR and nested conditions array.
4. Confidence scoring lives on `SignalRuleMatch.confidence` and is computed at rule-fire time.
5. Track retention: vessel_tracks table + Vessels::TrackRetentionJob shipped (Step 3). Append-only design — no updated_at, before_update guard throws abort. Composite index leads with vessel_id; separate occurred_at index for cross-vessel retention queries. BATCH_SIZE=1000 keeps transactions small.
6. AisIngestionService owns vessel upsert to preserve SRP; extract Vessels::StateUpdaterService only when manual injection is introduced (YAGNI).

---

## Known Bugs / Quirks

- ServiceResult (Data.define) exposes BOTH result.success (boolean) AND result.success? (method — `def success? = success`). The old MEMORY note claiming .success? raises NoMethodError was stale.
- AIS raw_payload uses key "dest" for destination, not "destination".
- Tasks::UpdateService requires string-keyed params, not symbol keys.

---

## Globe Notes

- Globe and replay are now aligned at both layers:
  - Frontend disables live signal polling during replay and queries signals with `to=as_of`
  - Backend `Api::SignalsController#index` applies `as_of` as an upper bound
- Globe signal rendering no longer tears down every entity on refresh; signals are diffed and updated in place.
- Globe selection is no longer site-only:
  - `site-*` opens readiness + task context
  - `asset-*` opens live telemetry context
  - `signal-*` opens source/type metadata and vessel enrichment when applicable
- Cesium attribution is visible again via a custom credit container; prior hidden-credit behavior was removed.
- Remaining “next level” work if resumed later:
  - selection highlighting on the globe
  - broader playback-grade trails for moving assets / vessels (now promoted as the next product slice)
  - batched or clustered signal rendering if density grows beyond entity comfort

---

## Working Style

- Step-by-step with full explanation before each step
- Staff engineer / architect / mentor mode
- Code review before every commit
- No co-authorship lines in commits
- One logical step at a time
- Always verify in preview browser before committing (stop hook enforces this)
- Run Rails with RAILS_MAX_THREADS=48, DB pool=70 to avoid SSE thread exhaustion
