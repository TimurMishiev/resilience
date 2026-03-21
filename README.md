# Resilience — Mission Operations Console

> A full-stack operational intelligence platform for managing distributed field operations at scale. Built as a portfolio project targeting defense-tech and mission-critical software companies (Palantir, Anduril, Reveal Technology).

---

## Live Demo

**[https://resilience-ops.fly.dev](https://resilience-ops.fly.dev)**

| Role | Email | Password |
|---|---|---|
| Commander | commander@resilience.mil | password123 |
| Operator | operator@resilience.mil | password123 |

Commanders have full write access. Operators can view and transition tasks but cannot create rules, inject signals, or access AI briefings.

---

## What It Is

Resilience is not a CRUD app dressed up with a dark theme. It is an **operational intelligence console** built around the same engineering patterns used in real mission-critical platforms:

- **Ontology-first domain model** — entities (Site, Task, Asset, Vessel, Signal, CorrelationRule, AreaOfOperation) are first-class with identity, state, and typed relationships. The data model is designed for a world where entities accumulate history and state transitions matter.
- **Controlled workflow state machines** — task and alert transitions are enforced server-side. The API exposes `GET /allowed_transitions` so the UI renders only valid next states. For performance, high-frequency surfaces (map task popups) mirror the transition table locally rather than issuing a per-row API call; the backend remains the authoritative gate. A small set of transitions (resolve, unblock, reopen) are additionally restricted to Commander in the UI as a sign-off convention.
- **Immutable audit log** — every mutation writes a before/after snapshot `AuditEvent` inside the same database transaction. The audit log is never stale or inconsistent.
- **Deterministic server-side replay** — sites, tasks, readiness, and audit events accept `?as_of=<ISO>` and reconstruct past state from the audit log. Risk scores are live-only (computed on demand, not snapshotted for replay). Task replay is capped at 500 records. Time travel is semantically consistent because it uses the same data the mutations wrote.
- **Intelligence fusion pipeline** — seven live signal feeds (aircraft, seismic, vessel, GPS jamming, wildfire, conflict events via ACLED, disaster alerts via GDACS) are ingested by background threads, stored as `ExternalSignal` records, and evaluated against a rules engine every 10 seconds.
- **Compound correlation engine** — rules support simple flat conditions or compound AND/OR logic across multiple signal types, with per-condition confidence scoring, atomic cooldown enforcement, AO-scoped evaluation, and SSE broadcast on fire.
- **Alert acknowledgment workflow** — every rule firing is a trackable `SignalRuleMatch` entity with its own state machine (UNACKNOWLEDGED → ACKNOWLEDGED → INVESTIGATING → CLOSED), actor recording, notes, and transition history.
- **Vessel intelligence** — AIS vessel entities are upserted from every ping, accumulate immutable track history with 7-day retention, generate derived `ais_gap` signals when vessels go dark, and render a full track polyline on the map.
- **Risk scoring** — per-site threat-pressure score (0–100) computed from three independent components: open alert confidence, inverted task readiness, and signal density within 100 km.
- **AI briefing grounded to real data** — Claude-powered operational summaries pass actual `AuditEvent` records as context. Every citation UUID the model returns is validated against the provided IDs — hallucinated events are stripped.
- **Role-based security throughout** — JWT auth with Commander/Operator roles. Commanders gate signal injection, rule management, site status, AoOs, and AI. Operators can create and transition tasks and triage alerts — triage is the operator's primary function. Rate limiting on every endpoint, Rack::Attack auto-ban, short-lived SSE tokens on the intelligence event stream.

---

## Feature Overview

| Feature | Description |
|---|---|
| **Dashboard** | Live KPI row (total/resolved/blocked/avg readiness), per-site readiness bars with color-coded scores and risk badges (LOW/MOD/HIGH/CRIT with breakdown tooltip), task status and priority bar charts, 30-day resolution throughput line chart, Recent Alerts panel with confidence badges and workflow status chips |
| **Sites** | Site inventory with status tags, readiness scores, risk score column (color-coded by level, hover for component breakdown) |
| **Site Detail** | Risk score history chart (Recharts ComposedChart — area fill + 3 component lines + threshold markers, lookback selector). 6-tab detail view: Tasks (inline create), Signals (proximity-filtered), Rule Fires, Assets, Audit Trail, **Timeline** — plus Activate/Deactivate and Unflag actions |
| **Site Timeline** | Unified threat timeline per site — merges signal detections, rule fires, task events, and audit entries into a single chronological spine; per-kind icon + color; expandable metadata; kind filter; 3d/7d/14d/30d lookback; auto-refreshes every 30s |
| **Tasks** | Full task management with controlled workflow transitions, blocked-reason enforcement, AI natural-language filter (`find all high-priority blocked tasks`), and per-task audit timeline |
| **Assets** | Asset inventory with type, status, and home site linkage |
| **Map** | MapLibre GL interactive map — site health markers, AoO polygon overlays, live signal layer (color-coded by type and recency, 7 signal types), vessel track polyline with intel panel, enriched signal detail panel (conflict: country/actor/fatalities; disaster: event type/alert level/severity), risk badge in site panel, task transitions directly from map popups |
| **Globe** | CesiumJS 3D globe with live asset telemetry — asset markers move in real time via SSE |
| **Graph** | D3 force-directed object graph showing site → task → asset dependency chains (Palantir ontology pattern) |
| **Signal Feed** | Infinite-scroll virtual list ([@tanstack/react-virtual](https://tanstack.com/virtual)) — only visible rows rendered regardless of total count; loads next page as you scroll; filterable by all 7 signal sources and types; speed/mag column shows fatalities for conflict events and alert score for disaster alerts; Commander inject-signal dialog runs correlation engine immediately |
| **Correlation Rules** | Visual rule builder — Simple or Compound (AND/OR multi-signal) mode; AO scope selector; dry-run against historical signals; 6 named templates (Maritime Deception, EW Precursor, Humanitarian Crisis, Seismic Threat, Air Approach, Multi-Domain Convergence) pre-fill the form on one click; MITRE ATT&CK technique tagging (12-technique curated picker, T-code badges on table) |
| **Areas of Operation** | Geofenced GeoJSON polygon AoOs with threat levels (green/amber/red/black) overlaid on map and globe, color-coded by threat |
| **Briefing** | Claude-powered AI operational summaries grounded in three context sources — audit events, nearby intelligence signals (ExternalSignal, 200 km/72 h), and recent rule fires; site selector scopes briefing to one site; grounding badge shows signal + rule fire record counts with tooltip breakdown; citation validation strips hallucinated UUIDs |
| **Replay** | Server-side time-travel for sites, tasks, readiness, and audit events — scrub to any past timestamp and reconstruct operational state from the audit log. Risk scores are live-only; task replay capped at 500 records |
| **Search** | `⌘K` global cross-entity search across sites, tasks, and assets |
| **Auth** | JWT role auth (Commander/Operator), protected routes, role-gated UI elements with lock indicators |
| **Real-time** | SSE push — rule fires (with confidence and workflow status), alert transitions, task mutations, and readiness scores stream live to all connected clients |
| **Offline** | Offline banner detects loss of connectivity; mutations disabled; cached data displayed |
| **Mobile** | Fully responsive — bottom tab bar, card layout, drawer navigation on small screens |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Frontend (React 19)                        │
│   Blueprint.js · TanStack Query · TanStack Virtual              │
│   MapLibre · CesiumJS · D3.js · Recharts                        │
│   TypeScript strict · Vite 6 · PWA (Workbox)                    │
└─────────────────────────┬───────────────────────────────────────┘
                          │ JSON REST + SSE
┌─────────────────────────▼───────────────────────────────────────┐
│                      Backend (Rails 8 API)                       │
│   Service layer · JWT · ActionController::Live · Rack::Attack    │
│   PostgreSQL 16 · pgcrypto UUIDs · structure.sql                 │
│   SolidQueue (async jobs) · SolidCache                           │
└──────────┬──────────────────────────────────────────┬───────────┘
           │ background threads (Puma)                │ SSE after commit
┌──────────▼────────────────────────────┐  ┌──────────▼───────────┐
│      Intelligence Fusion Pipeline     │  │   Sse::Broadcaster    │
│  OpenSky · USGS · AIS · GPSJam · FIRMS│  │   (singleton, thread  │
│  ACLED · GDACS                        │  │    safe, event typed) │
│  → ExternalSignal · Vessel · VesselTrack│
│  → GapDetectionJob (ais_gap signals)  │
│  → BackgroundEvaluator (every 10s)    │
│  → EvaluatorService (compound AND/OR) │
│  → RuleFiringService (atomic cooldown)│
│  → Alerts::TransitionService          │
│  → Risk::ScoringService (per-site)    │
└───────────────────────────────────────┘
```

### Architecture Decision Records

**Server-side replay** — Sites, tasks, readiness, and audit events accept `?as_of=<ISO>`. Past state is reconstructed from the audit log server-side; the frontend remains stateless with respect to time. Replay task responses are projection snapshots, not the same contract as live task responses. Risk scores are live-only — they are computed on demand and not replayed. Task replay is capped at 500 records.

**Workflow enforcement on the backend** — Transition rules live in the service layer. The API exposes `GET /allowed_transitions` so the UI renders only valid next states. High-frequency surfaces (map task popups) mirror the transition table locally for performance rather than fetching per-row — a deliberate trade-off. Commander-only transitions (resolve, unblock, reopen) are additionally enforced at the UI layer as a sign-off convention; the backend permits any authenticated user to perform task transitions, since operators are the primary triage layer by design.

**Audit log in the same transaction** — `AuditEvent` records (with `before_snapshot` and `after_snapshot`) are written inside the same `ActiveRecord::Base.transaction` block as the mutation they describe. The log is structurally impossible to diverge from the data.

**Atomic cooldown enforcement** — Rule cooldowns are claimed with a single `UPDATE correlation_rules SET last_fired_at = NOW() WHERE id = ? AND (last_fired_at IS NULL OR last_fired_at <= ?)`. If `rows_updated = 0`, the cooldown is still active and the job returns silently. Two concurrent job workers cannot double-fire the same rule.

**SSE over WebSockets** — Server-sent events are unidirectional, HTTP/2-compatible, and require no protocol upgrade or broker. Sufficient for this use case; simpler to operate in a single-dyno deployment.

**Compound rules via read-time normalization** — Legacy flat rules are coerced to `{ operator: "AND", conditions: [flat_condition] }` at read time via `rule.normalized_conditions`. Zero data migration required when compound support was added. The type discriminator is the presence of an `operator` key.

**Confidence scoring formula** — Direct condition: `proximity_score = 1 − (distance_km / proximity_km)`, clamped [0, 1]. Corroboration condition (when signal type differs): `(proximity_score + freshness) / 2` where `freshness = 1 − (age_seconds / window_seconds)` for the most recent qualifying nearby signal. AND rule → mean of scores. OR rule → max of scores.

**Vessel gap detection** — AIS vessels that have not been seen in N minutes (configurable) trigger derived `ais_gap` signals. Confidence is computed from speed at last observation (a slow-moving vessel going dark is more suspicious), plus a bonus for vessels inside high-threat Areas of Operation. Idempotency key: `gap_#{mmsi}_#{last_seen_at.to_i}`.

**Risk score formula** — Three independent components capped and summed:
- Alert pressure (0–40): `min(sum_of_open_match_confidences × 20, 40)` — 72h window
- Task health (0–30): `(1.0 − readiness_score) × 30` — nil readiness contributes 0, not risk
- Signal density (0–30): `min(signals_within_100km_24h × 2, 30)` — exact Haversine, bounding-box pre-filter
- Risk levels: LOW 0–25 · MODERATE 26–50 · HIGH 51–75 · CRITICAL 76–100

**Virtual list rendering** — The Signal Feed uses `@tanstack/react-virtual` with a fixed `estimateSize` of 40px per row. A separate sticky `<thead>` table sits above a fixed-height scrollable container. The virtualizer positions a `<table>` at `top: virtualItems[0].start` inside a `totalHeight`-tall div, creating the illusion of a full list while rendering only ~25 DOM nodes at any scroll position. `useInfiniteQuery` fetches the next page when the last virtual item is within 10 rows of the bottom.

**AI citation grounding** — The Claude briefing receives a JSON block of real `AuditEvent` IDs and content. The model is instructed to cite only from those IDs. Every UUID in the response is validated against the provided set — unrecognized IDs are stripped before the response reaches the client.

**Zero Cesium Ion dependency** — The 3D globe uses OpenStreetMap tiles (`UrlTemplateImageryProvider`) and an ellipsoid terrain provider. The globe works for any developer who clones the repo without any account or token.

**Signal detail panel: `p_*` property projection** — MapLibre GeoJSON features carry only JSON-serializable primitive values in their `properties` object. Rather than parsing `raw_payload` inside the hover popup (which would require a second React render or a string JSON.parse), the API serializes selected `raw_payload` keys as `p_*` prefixed properties at feature-generation time. The frontend reads `feature.properties.p_country` directly. This avoids per-hover deserialization and keeps the popup render path synchronous.

**Phase 3 GDACS without credentials** — GDACS provides a public GeoJSON endpoint requiring no API key. The feed thread runs unconditionally on every Rails boot, providing live disaster alert coverage for any developer who clones the repo. ACLED requires registration credentials and is credential-guarded; the feed silently returns 0 results when keys are absent, keeping boots clean in environments without credentials.

**Unified timeline via service merger** — `Sites::TimelineService` merges five heterogeneous event sources (ExternalSignal, SignalRuleMatch, Task creates, Task audit events, Site audit events) into a single sorted array. ExternalSignal proximity uses `ExternalSignal.near_point` (bounding-box pre-filter) followed by exact Haversine via `Correlations::EvaluatorService.haversine_km` to eliminate false positives at bounding-box corners. The service returns plain hashes — no ActiveRecord objects — keeping the controller thin and the response allocation predictable.

**Risk score snapshots for trend charts** — Hourly `Risk::SnapshotJob` (SolidQueue recurring) calls `Readiness::CalculationService` + `Risk::ScoringService` for every active site and writes a `SiteRiskSnapshot` row. 90-day retention via `prune_old!`. Seeds pre-populate 252 snapshots (28 × 9 sites, every 6 h over 7 days) with per-site trajectory profiles (sinusoidal + trend) so the chart is populated on a fresh `db:seed` — no waiting for hourly ticks.

**AI grounding extended to signals and rule fires** — `Ai::SummaryService` now passes three context blocks to Claude: AUDIT TRAIL (citable by UUID, full before/after), INTELLIGENCE SIGNALS (nearby ExternalSignals, 200 km/72 h, type-specific payload extraction), and RULE FIRES (SignalRuleMatch, 72 h). Only AuditEvent IDs are offered as citable entities — signal and rule fire IDs are contextual only — preserving citation-safety while dramatically increasing factual grounding. `context_counts` in the ServiceResult payload drives the frontend grounding badge.

**MITRE ATT&CK as a PostgreSQL text array** — `mitre_tags text[]` on `correlation_rules` uses PG's native array type with a `default: []`. No join table or JSON column needed for a bounded, ordered list of short strings. The frontend curates a closed set of 12 techniques (Enterprise + ICS ATT&CK) rather than free-form input, ensuring consistent taxonomy across rules. T-code strings are stable identifiers — technique names can change in MITRE's framework without invalidating stored data.

---

## Intelligence Fusion Pipeline

```
External feeds — background threads in Puma
  ├── OpenSky Network      aircraft_position signals    every 15 min, 4 theaters
  ├── USGS Earthquake      seismic_event signals        every 5 min,  M2.5+ global
  ├── AISHub               vessel_position signals      every 30 sec
  │     └── Vessel.upsert_from_signal! + VesselTrack append (immutable time-series)
  ├── GPSJam               gps_jamming signals          every 15 min
  ├── NASA FIRMS           wildfire signals             every 15 min
  ├── ACLED                conflict_event signals       every 60 min, 4 theaters, 3-day lookback
  │     magnitude = fatalities.to_f (nil when zero)
  └── GDACS                disaster_alert signals       every 15 min, global, no key required
        magnitude = episodealertscore (EQ/TC/FL/VO/DR/TS event types)

Derived signals — SolidQueue jobs
  └── GapDetectionJob      ais_gap signals              every 5 min
        confidence = base(0.50) + speed_modifier(±0.25) + high_threat_ao(+0.20)

ExternalSignal table (Postgres)

BackgroundEvaluator — every 10s, evaluates all active CorrelationRules
  │
  └── EvaluatorService — per rule:
        Flat rule:     signal_type + proximity + magnitude + count_threshold + cooldown
        AO scope:      target_sites scoped to rule.area_of_operation_id when set
        Compound AND:  ALL sub-conditions must match (direct or corroboration path)
        Compound OR:   ANY sub-condition sufficient
        Corroboration: when sub-condition signal_type ≠ incoming signal type →
                       DB query for recent qualifying signals of that type near site

  → RuleFiringService (on match)
        1. Atomic cooldown claim (UPDATE...WHERE — race-safe)
        2. Compute confidence score (per-condition formula, AND→mean, OR→max)
        3. Execute actions: create_task | escalate_task | flag_site ({{template}} interpolation)
        4. Write SignalRuleMatch (signal ↔ rule ↔ site ↔ task, confidence, workflow_status)
        5. Broadcast rule_fired SSE (after commit)

Alert lifecycle — Alerts::TransitionService
  SignalRuleMatch.workflow_status state machine:
    UNACKNOWLEDGED → ACKNOWLEDGED → INVESTIGATING → CLOSED
                   ↑____________________________________|
  Each transition records: actor (User FK), acknowledged_at, notes
  Broadcasts alert_transitioned SSE

Risk scoring — Risk::ScoringService (on demand, GET /api/risk_scores)
  Per site: alert_pressure + task_health + signal_density → 0–100 score + level

Risk snapshots — Risk::SnapshotJob (SolidQueue, every hour at :30)
  Writes SiteRiskSnapshot per active site; 90-day retention via prune_old!
  GET /api/sites/:id/risk_history → chronological snapshots for Recharts chart

Threat timeline — Sites::TimelineService (on demand, GET /api/sites/:id/timeline)
  Merges: signal_detected · rule_fired · task_created · task_transitioned · site_event
  Proximity filter: near_point bounding box → exact Haversine (200 km radius)
  Optional: ?kinds[]=rule_fired&days=7 filtering
```

### Compound Rule Format

```json
{
  "operator": "AND",
  "conditions": [
    { "signal_type": "aircraft_position", "proximity_km": 50 },
    { "signal_type": "gps_jamming",       "proximity_km": 100 }
  ]
}
```

Flat legacy rules (`{ "signal_type": "seismic_event", "magnitude_min": 4.5, "proximity_km": 200 }`) are coerced at read time — no migration, no breaking change.

---

## Alert Workflow State Machine

```
  ┌──────────────────┐
  │ UNACKNOWLEDGED   │  ← rule fires here
  └────────┬─────────┘
           │  acknowledge / investigate / close
  ┌────────▼─────────┐
  │  ACKNOWLEDGED    │
  └────────┬─────────┘
           │  investigate / close / unacknowledge
  ┌────────▼─────────┐
  │  INVESTIGATING   │
  └────────┬─────────┘
           │  close / acknowledge
  ┌────────▼─────────┐
  │     CLOSED       │  ← can re-open to investigating or unacknowledged
  └──────────────────┘
```

Every transition records the actor's User ID, timestamp, and optional notes. The full history is queryable. `GET /api/signal_rule_matches/:id/allowed_transitions` returns valid next states for the current status.

---

## Task Workflow State Machine

```
       ┌─────────┐
       │   new   │
       └────┬────┘
            │
       ┌────▼────┐
       │ triaged │◄──────────────────────┐
       └────┬────┘                       │
            │                            │
    ┌───────▼────────┐                   │
    │  in_progress   │                   │
    └──┬─────────┬───┘                   │
       │         │                       │
  ┌────▼───┐  ┌──▼──────┐               │
  │blocked │  │resolved │───────────────►┘
  └────┬───┘  └─────────┘
       │
       └──► in_progress
```

`blocked` requires a `blocked_reason` string. `resolved` records a `resolved_at` timestamp. All transitions enforced server-side; `GET /api/tasks/:id/allowed_transitions` drives the UI.

---

## Readiness Formula

```
score = (resolved / total × 0.60) + (non_blocked / total × 0.40)
```

Resolved tasks carry more weight than merely non-blocked ones. Returns `null` for sites with zero tasks (displayed as `—`, not `0%`). Computed on-demand, not cached — always reflects current state.

---

## Risk Score Formula

```
alert_pressure  = min(Σ open_match_confidence × 20,  40)   72-hour window
task_health     = (1.0 − readiness_score) × 30              nil → 0 (no tasks ≠ risk)
signal_density  = min(signals_within_100km_24h × 2,  30)   exact Haversine

risk_score = alert_pressure + task_health + signal_density   (0–100, integer)

LOW 0–25  ·  MODERATE 26–50  ·  HIGH 51–75  ·  CRITICAL 76–100
```

Visible on the Dashboard (badge per readiness bar), Map (site panel), and Sites page (dedicated column). Each badge shows a hover tooltip with the component breakdown.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Ruby on Rails 8.1, Ruby 3.4, PostgreSQL 16 |
| Frontend | React 19, TypeScript (strict mode), Blueprint.js v6 |
| State / Data | TanStack Query v5, React Context |
| Virtual list | TanStack Virtual v3 (`useVirtualizer` — infinite-scroll signal feed) |
| Maps | MapLibre GL JS |
| Globe | CesiumJS 1.139 — OSM tiles, zero Ion dependency |
| Graph | D3.js v7 force simulation |
| Charts | Recharts |
| AI | Anthropic Claude API (claude-haiku-4-5, via Rails proxy, citation-validated) |
| Real-time | ActionController::Live SSE (rule_fired, alert_transitioned, task events, telemetry) |
| Queue | SolidQueue (embedded in Puma via SOLID_QUEUE_IN_PUMA) |
| Cache | SolidCache |
| Auth | JWT (24h TTL), Rack::Attack (5 login/min, auto-ban on violations), SSE tokens (60s TTL, sse_only claim) |
| Build | Vite 6, vite-plugin-cesium |
| Testing | RSpec (508 examples, 0 failures), FactoryBot, Brakeman (0 warnings), bundler-audit (0 CVEs) |
| CI | GitHub Actions — typecheck, ESLint, RSpec, Brakeman, bundler-audit, yarn audit, Fly.io deploy |
| Deploy | Fly.io — combined Docker image (SPA built into Rails public/), single origin, no CORS |

---

## Project Structure

```
resilience/
├── backend/
│   ├── app/
│   │   ├── controllers/api/        19 REST + SSE controllers
│   │   │   ├── risk_scores_controller.rb   GET /api/risk_scores
│   │   │   ├── vessels_controller.rb       GET /api/vessels, GET /api/vessels/:id/tracks
│   │   │   └── signal_rule_matches_controller.rb
│   │   │       ├── GET  /api/signal_rule_matches
│   │   │       ├── POST /api/signal_rule_matches/:id/transition
│   │   │       └── GET  /api/signal_rule_matches/:id/allowed_transitions
│   │   ├── models/
│   │   │   ├── site.rb             status, flagged_at, flag_reason
│   │   │   ├── task.rb             workflow_status state machine
│   │   │   ├── asset.rb            home_site_id, AssetStatus
│   │   │   ├── external_signal.rb  signal_type, source, lat/lng, magnitude, raw_payload
│   │   │   ├── vessel.rb           mmsi, loitering_since, last_signal_id
│   │   │   ├── vessel_track.rb     append-only, immutable (before_update abort)
│   │   │   ├── correlation_rule.rb compound?, normalized_conditions, area_of_operation_id
│   │   │   ├── signal_rule_match.rb confidence, TRANSITIONS table, acknowledged_by FK
│   │   │   ├── area_of_operation.rb GeoJSON polygon, threat_level, color
│   │   │   └── audit_event.rb      before/after snapshots, schema_version, immutable
│   │   └── services/
│   │       ├── tasks/              CreationService, TransitionService, UpdateService
│   │       ├── signals/            IngestService
│   │       ├── vessels/            GapDetectionJob (→ ais_gap signals)
│   │       ├── feeds/              OpenSky, UsgsSeismic, Ais, Gpsjam, FirmsWildfire,
  │                       AcledIngestion, GdacsIngestion
│   │       ├── correlations/       EvaluatorService (AO-scoped), RuleFiringService,
│   │       │                       BackgroundEvaluator, DryRunService
│   │       ├── alerts/             TransitionService (alert acknowledgment workflow)
│   │       ├── risk/               ScoringService (alert_pressure + task_health + signal_density)
│   │       ├── sites/              TimelineService (5-source merger, Haversine proximity)
│   │       ├── ai/                 SummaryService (audit + signals + rule fires), FilterService
│   │       ├── readiness/          CalculationService
│   │       ├── replay/             ProjectionService (as_of reconstruction)
│   │       ├── sse/                Broadcaster (singleton, thread-safe, typed events)
│   │       └── telemetry/          SimulatorService (live asset position stream)
│   ├── jobs/
│   │   └── risk/                   SnapshotJob (SolidQueue, hourly) → SiteRiskSnapshot
│   ├── db/
│   │   ├── structure.sql           Authoritative schema — preserves CHECK constraints,
│   │   │                           indexes, FK cascade rules not captured by schema.rb
│   │   └── seeds.rb                9 sites · 4 theaters · 7 assets · 19 tasks ·
│   │                               5 Areas of Operation · 8 correlation rules (MITRE-tagged) ·
│   │                               6 demo vessels · demo conflict + disaster signals ·
│   │                               252 SiteRiskSnapshot history rows (28 × 9 sites)
│   └── spec/                       RSpec unit + request specs (508 examples)
├── frontend/
│   ├── src/
│   │   ├── api/                    Typed fetch wrappers — all resources, all params
│   │   │   ├── types.ts            Full domain type tree — RuleConditions union,
│   │   │   │                       isCompoundRule guard, SiteRiskScore, RiskLevel,
│   │   │   │                       AlertStatus, SignalType, VesselTrack
│   │   │   └── riskScores.ts       getRiskScores()
│   │   ├── components/             AppShell (SSE toasts), GlobalSearch (⌘K),
│   │   │                           ReplaySelector, AuditTimeline, ProtectedRoute,
│   │   │                           SiteTimeline (5-source spine), RiskScoreChart (Recharts),
│   │   │                           BriefingPanel (site selector, grounding badge)
│   │   ├── context/                AuthContext (JWT), ReplayContext (as_of)
│   │   ├── hooks/                  useEventSource, useTelemetryStream, useOnlineStatus,
│   │   │                           useSignals, useSignalsInfinite, useVessels,
│   │   │                           useVesselTracks, useRiskScores, useSiteTimeline,
│   │   │                           useSiteRiskHistory, useCorrelationRules,
│   │   │                           useAreasOfOperation, useSignalRuleMatches
│   │   └── pages/
│   │       ├── DashboardPage       KPIs, readiness bars + risk badges, charts, AlertsPanel
│   │       ├── SitesPage           Site list with risk score column
│   │       ├── SiteDetailPage      RiskScoreChart above tabs; 6-tab detail view
│   │       ├── TasksPage           NL filter, transitions, audit trail
│   │       ├── AssetsPage
│   │       ├── MapPage             MapLibre, signals layer, vessel track polyline,
│   │       │                       risk badge in site panel, AoO overlays
│   │       ├── GlobePage           CesiumJS, live telemetry
│   │       ├── GraphPage           D3 force-directed ontology graph
│   │       ├── SignalFeedPage      Virtual list (TanStack Virtual), infinite scroll,
│   │       │                       filterable, inject-signal dialog
│   │       ├── CorrelationRulesPage  compound rule builder, AO scope, dry-run,
│   │       │                         template picker dialog, MITRE tag picker
│   │       ├── AreasPage           AoO CRUD with map preview
│   │       └── BriefingPage        AI summaries, site selector, grounding badge
│   └── vite.config.ts
├── contracts/                      OpenAPI 3.1 specification
├── docs/                           Architecture Decision Records
└── .github/workflows/ci.yml        Full CI pipeline
```

---

## API Reference

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Exchange credentials for JWT |
| `DELETE` | `/api/auth/logout` | Invalidate session |

### Core Entities

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sites` | List sites — supports `?as_of=` |
| `GET` | `/api/sites/:id` | Site detail |
| `PATCH` | `/api/sites/:id/toggle_status` | Activate / deactivate (Commander) |
| `PATCH` | `/api/sites/:id/unflag` | Clear flag (Commander) |
| `GET` | `/api/sites/:id/timeline` | Unified threat timeline — `?days=7&kinds[]=rule_fired` — merges signals, rule fires, task events, audit entries |
| `GET` | `/api/sites/:id/risk_history` | Risk score snapshots — `?days=7` (1–30) — chronological SiteRiskSnapshot rows for trend chart |
| `GET` | `/api/tasks` | List tasks — `?as_of=`, `?site_id=`, `?workflow_status=`, `?priority=` |
| `POST` | `/api/tasks` | Create task |
| `PATCH` | `/api/tasks/:id` | Update task attributes |
| `POST` | `/api/tasks/:id/transition` | Execute workflow transition |
| `GET` | `/api/tasks/:id/allowed_transitions` | Valid next states |
| `GET` | `/api/assets` | List assets |
| `GET` | `/api/audit_events` | Immutable audit log — `?entity_type=`, `?entity_id=` |

### Intelligence

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/signals` | Signal feed — `?source=`, `?signal_type=`, `?site_id=`, `?from=`, `?to=`, `?page=`, `?per_page=` |
| `POST` | `/api/signals` | Inject signal manually — triggers correlation engine immediately (Commander) |
| `GET` | `/api/vessels` | Vessel list — `?mmsi=`, `?loitering=`, `?dark_hours=` |
| `GET` | `/api/vessels/:id/tracks` | Vessel track history — `?limit=` |
| `GET` | `/api/correlation_rules` | List rules |
| `POST` | `/api/correlation_rules` | Create rule — flat or compound, with optional `area_of_operation_id` scope (Commander) |
| `PATCH` | `/api/correlation_rules/:id` | Update rule (Commander) |
| `DELETE` | `/api/correlation_rules/:id` | Delete rule (Commander) |
| `POST` | `/api/correlation_rules/:id/dry_run` | Simulate rule against historical signals |
| `GET` | `/api/signal_rule_matches` | Rule firing history — `?rule_id=`, `?site_id=`, `?workflow_status=`, `?from=`, `?to=` |
| `POST` | `/api/signal_rule_matches/:id/transition` | Acknowledge / investigate / close alert |
| `GET` | `/api/signal_rule_matches/:id/allowed_transitions` | Valid next alert states |
| `GET` | `/api/areas_of_operation` | List AoOs |
| `POST` | `/api/areas_of_operation` | Create AoO (Commander) |
| `PATCH` | `/api/areas_of_operation/:id` | Update AoO (Commander) |
| `DELETE` | `/api/areas_of_operation/:id` | Delete AoO (Commander) |

### Analytics & AI

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/readiness` | Per-site readiness scores — supports `?as_of=` |
| `GET` | `/api/risk_scores` | Per-site risk scores — alert pressure + task health + signal density |
| `GET` | `/api/analytics/throughput` | Daily resolved task counts (last 30 days) |
| `POST` | `/api/ai/summary` | AI operational briefing — `site_activity`, `readiness_change`, `leadership_briefing` |
| `GET` | `/api/ai/filter` | NL → task filter params |

### Streams

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/events` | SSE — `rule_fired`, `alert_transitioned`, `task_created`, `task_transitioned`, `readiness_updated` |
| `GET` | `/api/telemetry/stream` | SSE — live asset position updates (simulated sensor stream) |

The events SSE stream (`/api/events`) requires a short-lived SSE token (`POST /api/sse_token`, 60s TTL, `sse_only` claim enforced). The telemetry stream (`/api/telemetry/stream`) uses the main JWT since it carries only simulated asset position data.

---

## Security

| Control | Detail |
|---|---|
| **Authentication** | JWT, 24h TTL, HS256, `Authorization: Bearer` header |
| **Authorization** | `require_commander!` on signals, rules, site status, AoOs, and AI endpoints. Task create/update/transition and alert triage are accessible to any authenticated user — operators are the primary triage layer by design |
| **Rate limiting** | Rack::Attack: 5 login attempts/min, 20/hr; AI endpoints: 10/min, 100/hr; general: 300/min |
| **Auto-ban** | 10+ Rack::Attack violations in 1hr → IP blocked for 1hr |
| **SSE tokens** | Short-lived (60s), `sse_only: true` claim; main JWT rejected on the events SSE endpoint. Telemetry stream uses the main JWT since it carries only simulated position data |
| **Audit log** | Append-only `AuditEvent` records with actor, before/after snapshots — written in same transaction as mutation |
| **SQL injection** | All queries parameterized via ActiveRecord; no string interpolation in queries |
| **Mass assignment** | Explicit `permit()` on all controller params |
| **Static analysis** | Brakeman (0 warnings), bundler-audit (0 CVEs) |

---

## Local Setup

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Ruby | 3.4+ | [rbenv](https://github.com/rbenv/rbenv) or [mise](https://mise.jdx.dev/) |
| Bundler | 2+ | `gem install bundler` |
| PostgreSQL | 16+ | `brew install postgresql@16` |
| Node.js | 22+ | [nvm](https://github.com/nvm-sh/nvm) or [mise](https://mise.jdx.dev/) |
| Yarn | 1.x | `npm install -g yarn` |

### 1 — Clone

```bash
git clone https://github.com/TimurMishiev/resilience.git
cd resilience
```

### 2 — Backend

```bash
cd backend
bundle install

# Create your local env file
cp .env.example .env

# Generate a secret key and paste it into .env as SECRET_KEY_BASE
bin/rails secret

# Create, migrate, and seed the database
# (seeds everything — sites, tasks, assets, vessels, signals, rules, areas)
rails db:create db:migrate db:seed

# Start the server
RAILS_MAX_THREADS=48 DB_POOL=70 rails server -p 3000
```

> **PostgreSQL note:** The app connects to `localhost:5432` with your system user by default.
> If your local Postgres requires a password, set `DATABASE_URL=postgres://user:pass@localhost/resilience_development` in `.env`.

### 3 — Frontend

Open a second terminal:

```bash
cd frontend
yarn install
yarn dev
# → http://localhost:5176
```

The Vite dev server proxies all `/api/*` requests to `:3000` — no CORS configuration needed.

### 4 — Log in

Open **http://localhost:5176** in your browser.

| Role | Email | Password | Access |
|---|---|---|---|
| Commander | commander@resilience.mil | password123 | Full write access — create rules, inject signals, manage all entities |
| Operator | operator@resilience.mil | password123 | Read + triage — view everything, transition tasks and alerts, no destructive actions |

### What you'll see after seed

- **9 sites** across 4 theaters (CENTCOM, INDOPACOM, EUCOM, AFRICOM) each with a live risk score
- **5 Areas of Operation** with threat-level polygon overlays
- **19 tasks** in various workflow states
- **7 assets** with live simulated telemetry (visible on Globe page)
- **8 correlation rules** (flat and compound AND/OR, including Phase 3 conflict/disaster rules scoped to CENTCOM/INDOPACOM)
- **Live signals** on the map — aircraft, vessel, seismic, GPS jamming, wildfire, conflict events, disaster alerts (all 7 types)
- **6 demo vessels** with track history — click any vessel dot for the full intel panel and track polyline
- **Enriched signal detail panel** — conflict events show country, actor, and fatality count; disaster alerts show event type, alert level (Green/Orange/Red), and severity description

### AI Briefing (optional)

The Briefing page requires an Anthropic API key. Get one free at [console.anthropic.com](https://console.anthropic.com/) and add it to `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Everything else — map, signals, rules, alerts, replay, graph, globe — works without it.

### Optional: Real-time external feeds

Demo seed data covers all 7 signal types out of the box. Add these to `.env` to enable live external ingestion:

| Feed | Env var | Notes |
|---|---|---|
| USGS Seismic | _(none)_ | Always live, no key needed |
| GPSJam | _(none)_ | Always live, no key needed |
| GDACS Disasters | _(none)_ | Always live, no key needed — global GeoJSON endpoint |
| OpenSky aircraft | `OPENSKY_USERNAME` + `OPENSKY_PASSWORD` | Runs anonymously without credentials (300s startup delay) |
| AIS vessels | `AISHUB_USERNAME` | Free account at aishub.net |
| NASA wildfire | `NASA_FIRMS_MAP_KEY` | Free NASA EarthData key |
| ACLED conflicts | `ACLED_API_KEY` + `ACLED_EMAIL` | Register at acleddata.com (free researcher access) |

---

## Testing

```bash
cd backend
bundle exec rspec --format documentation      # 508 examples, 0 failures
bundle exec brakeman --no-progress -q         # 0 security warnings
bundle exec bundler-audit check               # 0 CVEs

cd frontend
yarn tsc --noEmit                             # 0 TypeScript errors
yarn lint                                     # 0 ESLint errors
yarn build                                    # clean production build
```

Key spec coverage:
- `EvaluatorService` — compound AND/OR rules, direct path, corroboration path, AO scoping, no-fire when corroborating signal absent
- `RuleFiringService` — atomic cooldown (race condition), confidence scoring, action execution, SSE broadcast after commit
- `Risk::ScoringService` — all three components, caps, thresholds, nil readiness, time windows, exact Haversine distance
- `Alerts::TransitionService` — all valid transitions, all invalid transitions, actor recording, notes, SSE broadcast
- `Tasks::TransitionService` — full state machine, blocked_reason enforcement, resolved_at timestamp
- `Feeds::AcledIngestionService` — ingest, theater filter, dedup, fatality magnitude, notes truncation, date parsing, credential guard
- `Feeds::GdacsIngestionService` — ingest, GeoJSON coordinate order, magnitude, alertscore fallback, dedup, timestamp parsing, HTTP stubs
- `Sites::TimelineService` — 5 event sources, proximity filter, Haversine correctness, kind filtering, dedup, sort order
- `Risk::SnapshotJob` — iterates active sites, writes SiteRiskSnapshot, prunes old records, handles service failure gracefully
- `Ai::SummaryService` — audit event scoping (Site + Task events), signal context (GPS/conflict/disaster payloads), rule fire context, citation allow/strip, context_counts, error paths
- Request specs — auth guards (401/403 on every protected endpoint), role enforcement, pagination, mmsi filter, mitre_tags round-trip

---

## Build History

| Phase | What was built |
|---|---|
| 1–3 | Schema, models, service layer, REST endpoints, OpenAPI contract, typed React client |
| 4 | Audit timeline UI, server-side replay (`?as_of=`) |
| 5 | MapLibre GL interactive map with site markers |
| 6–7 | AI briefing + NL task filter (Claude API, citation-grounded) |
| 8 | AssetsPage, task transitions from map popups |
| 9 | JWT auth, TanStack Query, ProtectedRoute, role-based UI |
| 10 | Analytics dashboard — KPIs, readiness bars, throughput charts |
| 11 | SSE real-time push — tasks and readiness stream live |
| 12 | Map as command surface — transition tasks from map |
| 13 | Global `⌘K` search across all entities |
| 14 | PWA — service worker, offline cache, connection banner |
| 15 | Live asset telemetry via SSE — simulated sensor stream |
| 16 | D3 force-directed object graph (Palantir ontology pattern) |
| 17 | Responsive mobile layout — bottom nav, card layout |
| 18 | CesiumJS 3D globe with live asset telemetry |
| A | OpenSky live aircraft feed + correlation engine (backend) |
| B | Correlation Rules UI — CRUD, recent firings, dry-run, role-gated |
| C | Areas of Operation — geofenced polygons, threat levels, map overlays |
| D | Multi-feed intelligence fusion — USGS, AIS, GPSJam, FIRMS Wildfire |
| E | Signal layer on map — color-coded circles, toggle, info panel |
| **v2-1** | **Vessel intelligence** — Vessel + VesselTrack entities, AIS upsert, 7-day track retention |
| **v2-2** | **AIS gap detection** — GapDetectionJob synthesizes `ais_gap` derived signals with confidence scoring |
| **v2-3** | **Compound AND/OR rules** — normalized_conditions, backward-compatible with all legacy flat rules |
| **v2-4** | **Compound evaluation** — EvaluatorService direct + corroboration paths; AND/OR logic |
| **v2-5** | **Confidence scoring** — per-condition proximity/freshness formula, AND→mean, OR→max |
| **v2-6** | **Alert acknowledgment** — SignalRuleMatch state machine, Alerts::TransitionService, actor recording |
| **v2-7** | **Enriched SSE** — rule_fired includes confidence + status; alert_transitioned toast with notes |
| **v2-8** | **Compound rule builder UI** — visual AND/OR editor, Simple/Compound toggle, CompoundBuilder component |
| **v2-9** | **Vessel track polyline + intel panel** — click any vessel dot on the map for name/flag/type/dark/loitering status + dashed track polyline drawn from VesselTrack history |
| **v2-10** | **AO-scoped correlation rules** — rule builder AO selector, EvaluatorService scopes target_sites by AO, dry-run respects same scoping |
| **v2-11** | **Risk score per site** — Risk::ScoringService (alert pressure + task health + signal density → 0–100), GET /api/risk_scores, Dashboard badges, Map panel, Sites column |
| **v2-12** | **Virtual list + infinite scroll** — @tanstack/react-virtual with useInfiniteQuery; constant DOM node count at any signal volume; auto-fetch on scroll |
| **v3-1** | **ACLED conflict events feed** — AcledIngestionService polls ACLED API every 60 min; 4 theater bounding boxes; fatalities → magnitude; 3-day lookback; credential-guarded (returns 0 when key absent); 18 RSpec examples |
| **v3-2** | **GDACS disaster alerts feed** — GdacsIngestionService polls GDACS GeoJSON API every 15 min; no credentials required; episodealertscore → magnitude; EQ/TC/FL/VO/DR/TS types; stable external_id = `gdacs_{type}_{eventid}_{episodeid}`; 17 RSpec examples |
| **v3-3** | **Phase 3 demo seeds** — 5 ACLED conflict_event + 5 GDACS disaster_alert demo signals near seeded sites; 3 new compound correlation rules (CENTCOM armed conflict, INDOPACOM major disaster, compound crisis AND rule); CorrelationRule.VALID_SIGNAL_TYPES extended to include new types |
| **v3-4** | **Enriched signal detail panel** — MapPage hover popup + click panel extended with type-specific fields: conflict (country, actor, fatalities, sub_event_type); disaster (event type, alert level badge Green/Orange/Red, severity text, event name); TypeScript-safe IIFE pattern for unknown-typed raw_payload rendering |
| **v3-5** | **Phase 3 signal coverage** — all 7 signal types visible on Map, Globe, Signal Feed, Correlation Rules builder; SignalFeedPage speedOrMag() shows fatalities/score; GlobePage + SignalFeedPage extended with conflict (purple) and disaster (hot-pink) color/label entries |
| **v4-1** | **Unified threat timeline** — `Sites::TimelineService` merges 5 event sources (signal_detected, rule_fired, task_created, task_transitioned, site_event) with exact Haversine proximity filter; GET /api/sites/:id/timeline with ?days= and ?kinds[]= params; 28 RSpec examples |
| **v4-2** | **SiteTimeline component** — vertical spine + per-kind icon/color (satellite, warning-sign, add-to-artifact, exchange, map-marker); confidence badge + workflow chip on rule fires; expandable metadata panel; kind filter button group; lookback selector 3d/7d/14d/30d; auto-refresh 30s; "Timeline" tab on SiteDetailPage |
| **v5-1** | **Risk score snapshots** — `SiteRiskSnapshot` model (UUID PK, site FK, score, risk_level, component decimals, recorded_at); `Risk::SnapshotJob` (SolidQueue recurring, every hour at :30); 90-day retention; GET /api/sites/:id/risk_history; 10 RSpec examples |
| **v5-2** | **RiskScoreChart** — Recharts ComposedChart: Area fill (gradient) for total score, dashed Lines for alert_pressure/task_health/signal_density, ReferenceLine thresholds at 25/50/75, custom tooltip with risk level, lookback selector, components toggle; 252 historical seed snapshots with per-site trajectory profiles |
| **v6-1** | **AI grounding enrichment** — `Ai::SummaryService` rewritten with three context blocks (AUDIT TRAIL + INTELLIGENCE SIGNALS + RULE FIRES); signals fetched within 200 km/72 h with type-specific payload extraction; rule fires fetched within 72 h; citation safety preserved (only AuditEvent IDs citable); context_counts in ServiceResult payload; fixed scoping bug (was dropping Site-level audit events); 21 RSpec examples |
| **v6-2** | **BriefingPanel enrichment** — site selector (all sites / specific site); GroundingBadge shows total records + signal/alert sub-badges with tooltip breakdown showing audit events, signal count, rule fire count |
| **v7-1** | **Named rule templates** — 6 pre-built tactical patterns (Maritime Deception, EW Precursor, Humanitarian Crisis Indicator, Significant Seismic Activity, Air Approach Warning, Multi-Domain Threat Convergence); "From Template" button opens 2-column card picker dialog; selecting a template merges form state into DEFAULT_FORM and opens rule drawer pre-filled; all fields editable before saving |
| **v9-1** | **MITRE ATT&CK tagging** — `mitre_tags text[]` column on correlation_rules; 12-technique curated constant (Enterprise + ICS ATT&CK — T1036/T1040/T1498/T1562/T1565/T1583/T1590/T1591/T0826/T0827/T0879/T0880); toggleable pill picker in rule form with selected-name summary; T-code badges in rules table with tactic tooltip; all 8 seeded rules tagged; all 6 templates tagged; 3 new request specs |

---

## License

MIT
