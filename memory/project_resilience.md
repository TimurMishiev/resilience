---
name: project_resilience
description: Full stack, architecture, domain models, feature status
type: project
---

# Resilience — Project Memory

## Stack

- **Backend:** Ruby on Rails (API mode), PostgreSQL, Sidekiq, Redis, SSE for real-time push
- **Frontend:** React + TypeScript, Vite, Blueprint UI, CesiumJS, MapLibre GL
- **Deployment:** Fly.io (backend + postgres), Vite dev server locally
- **Testing:** RSpec (backend), ESLint + TypeScript build validation (frontend)

---

## Domain Model

### Core Entities

- **Site** — a monitored geographic area or facility. Has status (active/inactive), flagged state, audit trail.
- **Vessel** — first-class AIS entity. Fields: mmsi (unique), name, vessel_type, flag, destination, lat, lng, speed, heading, first_seen_at, last_seen_at, last_signal_id (FK to external_signals), loitering_since.
- **ExternalSignal** (external_signals table) — raw inbound sensor/feed data. Separate from entity state.
- **SignalRule** — user-defined rule that matches on signal properties. Supports single and (upcoming) compound conditions.
- **SignalRuleMatch** — recorded fire when a rule matches a signal. Will gain confidence float field.
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
- **EvaluatorService** — evaluates SignalRules against incoming signals. Will be extended for compound conditions.
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
- Confidence scoring: base 0.50, +0.25 if speed ≥ 5kn, -0.20 if speed < 1kn, +0.20 if inside high-threat AO bbox
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
- **Phase 4** is partially complete:
  - risk scores are shipped
  - CI + auto-deploy to Fly are shipped
  - virtualization currently exists in the signal feed, not broadly across all large data surfaces
  - globe benchmarking/perf instrumentation exists and the focused-to-global reconcile benchmark is now budgeted in Playwright + CI
  - broader perf budgets and guardrails beyond the globe benchmark remain a closeout task

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
  - Globe heatmap parity is not implemented and should be treated as optional polish unless Phase 3 scope is explicitly expanded.
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
  - Other potentially large tables/surfaces should be evaluated and virtualized only where needed.
  - Current Phase 4 audit result: the remaining list/table pages are mostly bounded at 50-100 rows and do not yet justify blanket virtualization. The next pressure point should be chosen based on measured volume, not roadmap cargo culting.
- **Benchmarks**
  - Globe benchmark coverage exists and now enforces explicit release budgets on the focused-to-global reconcile path.
  - CI runs the Dockerized app and fails if the benchmark breaches its budget.
  - Remaining work is to broaden budgets/guardrails beyond the globe benchmark where justified.
- **Auto-deploy**
  - Already implemented through GitHub Actions + Fly deploy on main after green checks.

### Post-v1 Candidate Expansions

- **Kill-chain / prosecution workflow**
  - Not part of the current canonical 4-phase roadmap.
  - Sensible future addition if the product evolves from incident response into end-to-end prosecution workflow.
- **Cross-entity natural-language ontology query**
  - Not part of the current canonical 4-phase roadmap.
  - Natural-language filter translation exists for tasks/signals, but graph-style ontology traversal via NL does not.
  - Treat as a future expansion unless it is explicitly promoted into the roadmap.

### Locked Finish Plan (2026-03-29)

Future agents should treat this as the current required completion sequence unless the user explicitly changes roadmap scope.

If any external summary, audit, or delegated-agent note disagrees with this section, prefer this section unless the codebase itself has changed and been re-verified.

#### Required completion track

1. **Phase 4 closeout**
   - Expand virtualization only where measured large data surfaces justify it.
   - Broaden benchmark/perf budgets beyond the current globe reconcile gate as an explicit release bar.

#### Recently closed

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

#### Explicit non-goals for current v1 closeout

- Do **not** rebuild map heatmap from scratch; it is already shipped.
- Do **not** treat globe heatmap parity as required unless Phase 3 scope is explicitly expanded.
- Do **not** treat kill-chain/prosecution or cross-entity NL ontology query as current v1 blockers.
  - They remain post-v1 expansions unless the user explicitly promotes them into the roadmap.

#### Sequence lock

- The required implementation order is:
  1. Phase 4 closeout

#### Expected remaining canonical phases

- **Phase 3** is complete for the current canonical v1 scope.
- **Phase 4** remains partially open.
- Phase 2 is functionally complete, and the chokepoint overlay adjunct is now closed.

---

## Architectural Decisions

1. Fusion layer lives INSIDE the existing correlation engine (extended schema), not a separate engine.
2. AIS gap detection uses a periodic background job (Vessels::GapDetectionJob) that synthesizes ais_gap signals — these flow through the existing correlation engine unchanged.
3. Compound rule conditions: extend JSONB conditions schema with operator: AND/OR and nested conditions array.
4. Confidence scoring: add confidence float to SignalRuleMatch.
5. Track retention: vessel_tracks table + Vessels::TrackRetentionJob shipped (Step 3). Append-only design — no updated_at, before_update guard throws abort. Composite index leads with vessel_id; separate occurred_at index for cross-vessel retention queries. BATCH_SIZE=1000 keeps transactions small.
6. AisIngestionService owns vessel upsert to preserve SRP; extract Vessels::StateUpdaterService only when manual injection is introduced (YAGNI).

---

## Known Bugs / Quirks

- ServiceResult (Data.define) exposes result.success (boolean), NOT result.success? (method). Using .success? raises NoMethodError.
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
  - broader playback-grade trails for moving assets / vessels
  - globe heatmap parity if Phase 3 scope is expanded beyond the shipped map heatmap
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
