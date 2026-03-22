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

### Phase 1 — Intelligence Layer (IN PROGRESS)

**Step 1 — vessels table** (DONE, committed: af36c08)
- New table: vessels with mmsi (unique), name, vessel_type, flag, destination, lat, lng, speed, heading, first_seen_at, last_seen_at, last_signal_id (FK to external_signals), loitering_since
- Indexes: unique on mmsi, index on last_seen_at, partial index on loitering_since (WHERE NOT NULL)
- Model: Vessel with validations, scopes (dark_since, loitering), upsert_from_signal! class method
- 23 RSpec examples, all passing

**Step 2 — Wire vessel upsert into AIS ingestion** (DONE, committed: 6fe6352)
- AisIngestionService now calls Vessel.upsert_from_signal! after every successful AIS ping
- Design: upsert lives in AisIngestionService (not IngestService) — preserves SRP
- YAGNI: when manual injection is added, extract Vessels::StateUpdaterService at that point
- Bug fixed: result.success? doesn't exist on ServiceResult (Data.define) — must use result.success
- Bug fixed: destination key in AIS raw_payload is "dest", not "destination"
- Bug fixed: name priority is payload["name"] || payload["callsign"]
- 29 RSpec examples, all passing

**Step 3 — vessel_tracks table + retention job** (DONE, committed: b7e2323)
- New table: `vessel_tracks` with fields: vessel_id (FK, CASCADE), lat, lng, speed, heading, occurred_at, created_at (NO updated_at — append-only by design)
- Indexes: composite (vessel_id, occurred_at) for read queries, separate (occurred_at) for retention deletes
- Model: VesselTrack — append-only enforced via before_update { throw :abort }, scopes: between(from, to), older_than(duration)
- Job: Vessels::TrackRetentionJob — batched deletion (BATCH_SIZE=1000), runs daily at 3am via SolidQueue recurring
- Registered in config/recurring.yml
- Track insertion wired into AisIngestionService — only on newly created signals (result.payload[:created] == true), not duplicate replays
- 260 RSpec examples total, 0 failures
- Files: backend/db/migrate/20260318030001_create_vessel_tracks.rb, backend/app/models/vessel_track.rb, backend/app/jobs/vessels/track_retention_job.rb, backend/spec/models/vessel_track_spec.rb, backend/spec/jobs/vessels/track_retention_job_spec.rb, backend/spec/factories/vessel_tracks.rb

Key engineering decisions from Step 3:
- "Day 2 thinking": build retention policy BEFORE the data, not after
- Append-only tables have no updated_at column — the absence is a structural signal to readers
- Composite index leads with vessel_id (not occurred_at) — wrong order would miss the primary query pattern
- Separate occurred_at index justified because retention job queries across ALL vessels
- BATCH_SIZE=1000 for deletion — keeps transactions small, avoids lock contention, gives Postgres time to autovacuum
- BRIN index noted as future optimization for very high write volumes (not needed yet)
- Track deduplication: only insert when signal is newly created, not on re-polls

**Step 4 — AIS gap detection job** (TODO — next)
- Synthesizes ais_gap derived signals when vessel unseen > 20 minutes
- Vessels::GapDetectionJob (periodic background job)
- Gap signals flow through the existing correlation engine unchanged

**Step 5 — Compound rule conditions** (TODO)
- Extend JSONB conditions schema with operator: AND/OR and nested conditions array

**Step 6 — Update EvaluatorService for compound conditions** (TODO)

**Step 7 — Confidence scoring on SignalRuleMatch** (TODO)
- Add confidence float to SignalRuleMatch

**Step 8 — Alert acknowledgment workflow** (TODO)

**Step 9 — Enriched SSE payloads + toasts** (TODO)

**Step 10 — Compound rule builder UI** (TODO)

---

## Roadmap (v2+ plan)

| Phase | Focus |
|-------|-------|
| Phase 1 | Intelligent correlation (vessels, gap detection, compound rules, confidence, alert ACK) |
| Phase 2 | Maritime operational depth (loitering, chokepoints, SALUTE, PACE, commander intent, keyboard palette) |
| Phase 3 | Visual intelligence (track trails, heatmap, swimlane viz, globe playback) |
| Phase 4 | Command polish (virtual rendering, risk score, benchmarks, auto-deploy) |

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
- Backend request specs currently cannot be run in this environment because `bundler 2.7.2` from `Gemfile.lock` is not installed locally.

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
  - track trails for moving assets / vessels
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
