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

- **Ontology-first domain model** — entities (Site, Task, Asset, Vessel, Signal, CorrelationRule) are first-class with identity, state, and typed relationships. The data model is designed for a world where entities accumulate history and state transitions matter.
- **Controlled workflow state machines** — task and alert transitions are enforced exclusively server-side with an allowed-transitions table. The frontend fetches valid next states and renders only those. No business logic lives in the UI.
- **Immutable audit log** — every mutation writes a before/after snapshot `AuditEvent` inside the same database transaction. The audit log is never stale or inconsistent.
- **Deterministic server-side replay** — any read endpoint accepts `?as_of=<ISO>` and reconstructs past state from the audit log. Time travel is semantically consistent because it uses the same data the mutations wrote.
- **Intelligence fusion pipeline** — five live external feeds (aircraft, seismic, vessel, GPS jamming, wildfire) are ingested by background threads, stored as `ExternalSignal` records, and evaluated against a rules engine every 10 seconds.
- **Compound correlation engine** — rules support simple flat conditions or compound AND/OR logic across multiple signal types, with per-condition confidence scoring, atomic cooldown enforcement, and SSE broadcast on fire.
- **Alert acknowledgment workflow** — every rule firing is a trackable `SignalRuleMatch` entity with its own state machine (UNACKNOWLEDGED → ACKNOWLEDGED → INVESTIGATING → CLOSED), actor recording, notes, and transition history.
- **Vessel intelligence** — AIS vessel entities are upserted from every ping, accumulate track history with 7-day retention, and generate derived `ais_gap` signals when vessels go dark (spoofing indicator).
- **AI briefing grounded to real data** — Claude-powered operational summaries pass actual `AuditEvent` records as context. Every citation UUID the model returns is validated against the provided IDs — hallucinated events are stripped.
- **Role-based security throughout** — JWT auth with Commander/Operator roles, rate limiting on every sensitive endpoint, Rack::Attack auto-ban on violation accumulation, SSE tokens with 60s TTL and `sse_only` claim.

---

## Feature Overview

| Feature | Description |
|---|---|
| **Dashboard** | Live KPI row (total/resolved/blocked/avg readiness), per-site readiness bars with color-coded scores, task status and priority bar charts, 30-day resolution throughput line chart, Recent Alerts panel with confidence badges and workflow status chips |
| **Sites** | Site inventory with status tags, readiness scores, and one-click detail navigation |
| **Site Detail** | 5-tab detail view: Tasks (with inline create), Signals (proximity-filtered), Rule Fires, Assets, Audit Trail — plus Activate/Deactivate and Unflag actions |
| **Tasks** | Full task management with controlled workflow transitions, blocked-reason enforcement, AI natural-language filter (`find all high-priority blocked tasks`), and per-task audit timeline |
| **Assets** | Asset inventory with type, status, and home site linkage |
| **Map** | MapLibre GL interactive map — site health markers, AoO polygon overlays, live signal layer (color-coded by type and recency), transition tasks directly from map popups |
| **Globe** | CesiumJS 3D globe with live asset telemetry — asset markers move in real time via SSE |
| **Graph** | D3 force-directed object graph showing site → task → asset dependency chains (Palantir ontology pattern) |
| **Signal Feed** | Live paginated table of all ingested signals, filterable by source and type; Commander inject-signal dialog that runs the correlation engine immediately |
| **Correlation Rules** | Visual rule builder — Simple mode (flat condition) or Compound mode (AND/OR multi-signal with per-condition signal type, proximity, and magnitude); table shows compound badge; dry-run against historical signals before activating |
| **Areas of Operation** | Geofenced GeoJSON polygon AoOs with threat levels (green/amber/red/black) overlaid on map and globe, color-coded by threat |
| **Briefing** | Claude-powered AI operational summaries (site activity, readiness change, leadership briefing) with citation-validated grounding to live audit events |
| **Replay** | Server-side time-travel — scrub to any past timestamp and see the full operational state as it existed at that moment |
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
│   Blueprint.js · TanStack Query · MapLibre · CesiumJS · D3.js   │
│   Recharts · TypeScript strict · Vite 6 · PWA (Workbox)         │
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
│  → ExternalSignal · Vessel · VesselTrack│  │    safe, event typed) │
│  → GapDetectionJob (ais_gap signals)  │  └──────────────────────┘
│  → BackgroundEvaluator (every 10s)    │
│  → EvaluatorService (compound AND/OR) │
│  → RuleFiringService (atomic cooldown)│
│  → Alerts::TransitionService          │
└───────────────────────────────────────┘
```

### Architecture Decision Records

**Server-side replay** — All read endpoints accept `?as_of=<ISO>`. Past state is reconstructed from the audit log server-side, not replayed client-side. The frontend remains completely stateless with respect to time. The replica shows exactly what an analyst would have seen at that timestamp.

**Workflow enforcement on the backend** — Transition rules live exclusively in the service layer. The API exposes `GET /allowed_transitions` so the UI renders only valid next states. This makes the constraint unbypassable regardless of what a client sends.

**Audit log in the same transaction** — `AuditEvent` records (with `before_snapshot` and `after_snapshot`) are written inside the same `ActiveRecord::Base.transaction` block as the mutation they describe. The log is structurally impossible to diverge from the data.

**Atomic cooldown enforcement** — Rule cooldowns are claimed with a single `UPDATE correlation_rules SET last_fired_at = NOW() WHERE id = ? AND (last_fired_at IS NULL OR last_fired_at <= ?)`. If `rows_updated = 0`, the cooldown is still active and the job returns silently. Two concurrent job workers cannot double-fire the same rule.

**SSE over WebSockets** — Server-sent events are unidirectional, HTTP/2-compatible, and require no protocol upgrade or broker. Sufficient for this use case; simpler to operate in a single-dyno deployment.

**Compound rules via read-time normalization** — Legacy flat rules are coerced to `{ operator: "AND", conditions: [flat_condition] }` at read time via `rule.normalized_conditions`. Zero data migration required when compound support was added. The type discriminator is the presence of an `operator` key.

**Confidence scoring formula** — Direct condition: `proximity_score = 1 − (distance_km / proximity_km)`, clamped [0, 1]. Corroboration condition (when signal type differs): `(proximity_score + freshness) / 2` where `freshness = 1 − (age_seconds / window_seconds)` for the most recent qualifying nearby signal. AND rule → mean of scores. OR rule → max of scores.

**Vessel gap detection** — AIS vessels that have not been seen in N minutes (configurable) trigger derived `ais_gap` signals. Confidence is computed from speed at last observation (a slow-moving vessel going dark is more suspicious), plus a bonus for vessels inside high-threat Areas of Operation. Idempotency key: `gap_#{mmsi}_#{last_seen_at.to_i}`.

**AI citation grounding** — The Claude briefing receives a JSON block of real `AuditEvent` IDs and content. The model is instructed to cite only from those IDs. Every UUID in the response is validated against the provided set — unrecognized IDs are stripped before the response reaches the client.

**Zero Cesium Ion dependency** — The 3D globe uses OpenStreetMap tiles (`UrlTemplateImageryProvider`) and an ellipsoid terrain provider. The globe works for any developer who clones the repo without any account or token.

---

## Intelligence Fusion Pipeline

```
External feeds — background threads in Puma
  ├── OpenSky Network      aircraft_position signals    every 15 min, 4 theaters
  ├── USGS Earthquake      seismic_event signals        every 5 min,  M2.5+ global
  ├── AISHub               vessel_position signals      every 15 min
  │     └── Vessel.upsert_from_signal! + VesselTrack append (immutable time-series)
  ├── GPSJam               gps_jamming signals          every 15 min
  └── NASA FIRMS           wildfire signals             every 15 min

Derived signals — SolidQueue jobs
  └── GapDetectionJob      ais_gap signals              every 5 min
        confidence = base(0.50) + speed_modifier(±0.25) + high_threat_ao(+0.20)

ExternalSignal table (Postgres)

BackgroundEvaluator — every 10s, evaluates all active CorrelationRules
  │
  └── EvaluatorService — per rule:
        Flat rule:     signal_type + proximity + magnitude + count_threshold + cooldown
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

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Ruby on Rails 8.1, Ruby 3.4, PostgreSQL 16 |
| Frontend | React 19, TypeScript (strict mode), Blueprint.js v6 |
| State / Data | TanStack Query v5, React Context |
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
| Testing | RSpec (324 examples, 0 failures), FactoryBot, Brakeman (0 warnings), bundler-audit (0 CVEs) |
| CI | GitHub Actions — typecheck, RSpec, Brakeman, bundler-audit, yarn audit, Fly.io deploy |
| Deploy | Fly.io — combined Docker image (SPA built into Rails public/), single origin, no CORS |

---

## Project Structure

```
resilience/
├── backend/
│   ├── app/
│   │   ├── controllers/api/        18 REST + SSE controllers
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
│   │   │   ├── correlation_rule.rb compound?, normalized_conditions, cooldown
│   │   │   ├── signal_rule_match.rb confidence, TRANSITIONS table, acknowledged_by FK
│   │   │   ├── area_of_operation.rb GeoJSON polygon, threat_level, color
│   │   │   └── audit_event.rb      before/after snapshots, schema_version, immutable
│   │   └── services/
│   │       ├── tasks/              CreationService, TransitionService, UpdateService
│   │       ├── signals/            IngestService
│   │       ├── vessels/            GapDetectionJob (→ ais_gap signals)
│   │       ├── feeds/              OpenSky, UsgsSeismic, Ais, Gpsjam, FirmsWildfire
│   │       ├── correlations/       EvaluatorService, RuleFiringService,
│   │       │                       BackgroundEvaluator, DryRunService
│   │       ├── alerts/             TransitionService (alert acknowledgment workflow)
│   │       ├── ai/                 SummaryService (grounded), FilterService (NL→params)
│   │       ├── readiness/          CalculationService
│   │       ├── replay/             ProjectionService (as_of reconstruction)
│   │       ├── sse/                Broadcaster (singleton, thread-safe, typed events)
│   │       └── telemetry/          SimulatorService (live asset position stream)
│   ├── db/
│   │   ├── structure.sql           Authoritative schema — preserves CHECK constraints,
│   │   │                           indexes, FK cascade rules not captured by schema.rb
│   │   └── seeds.rb                9 sites · 4 theaters · 7 assets · 19 tasks ·
│   │                               5 Areas of Operation · 5 correlation rules ·
│   │                               demo vessel + wildfire signals
│   └── spec/                       RSpec unit + request specs (324 examples)
├── frontend/
│   ├── src/
│   │   ├── api/                    Typed fetch wrappers — all resources, all params
│   │   │   └── types.ts            Full domain type tree, RuleConditions union,
│   │   │                           isCompoundRule type guard, AlertStatus, SignalType
│   │   ├── components/             AppShell (SSE toasts), GlobalSearch (⌘K),
│   │   │                           ReplaySelector, AuditTimeline, ProtectedRoute
│   │   ├── context/                AuthContext (JWT), ReplayContext (as_of)
│   │   ├── hooks/                  useEventSource, useTelemetryStream, useOnlineStatus,
│   │   │                           useSignals, useCorrelationRules, useAreasOfOperation,
│   │   │                           useSignalRuleMatches
│   │   └── pages/
│   │       ├── DashboardPage       KPIs, readiness bars, charts, AlertsPanel
│   │       ├── SitesPage / SiteDetailPage (5 tabs)
│   │       ├── TasksPage           NL filter, transitions, audit trail
│   │       ├── AssetsPage
│   │       ├── MapPage             MapLibre, signals layer, AoO overlays
│   │       ├── GlobePage           CesiumJS, live telemetry
│   │       ├── GraphPage           D3 force-directed ontology graph
│   │       ├── SignalFeedPage      paginated, filterable, inject-signal dialog
│   │       ├── CorrelationRulesPage  compound rule builder, dry-run, firing history
│   │       ├── AreasPage           AoO CRUD with map preview
│   │       └── BriefingPage        AI summaries with citation rendering
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
| `DELETE` | `/api/sites/:id/flag` | Clear flag (Commander) |
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
| `GET` | `/api/signals` | Signal feed — `?source=`, `?signal_type=`, `?site_id=`, `?from=`, `?to=` |
| `POST` | `/api/signals` | Inject signal manually — triggers correlation engine immediately (Commander) |
| `GET` | `/api/correlation_rules` | List rules |
| `POST` | `/api/correlation_rules` | Create rule — flat or compound (Commander) |
| `PATCH` | `/api/correlation_rules/:id` | Update rule (Commander) |
| `DELETE` | `/api/correlation_rules/:id` | Delete rule (Commander) |
| `GET` | `/api/correlation_rules/:id/dry_run` | Simulate rule against historical signals |
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
| `GET` | `/api/analytics/throughput` | Daily resolved task counts (last 30 days) |
| `POST` | `/api/ai/summary` | AI operational briefing — `site_activity`, `readiness_change`, `leadership_briefing` |
| `GET` | `/api/ai/filter` | NL → task filter params |

### Streams

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/events` | SSE — `rule_fired`, `alert_transitioned`, `task_created`, `task_transitioned`, `readiness_updated` |
| `GET` | `/api/telemetry` | SSE — live asset position updates (simulated sensor stream) |

All SSE streams require a short-lived SSE token (`GET /api/auth/sse_token`, 60s TTL, `sse_only` claim enforced).

---

## Security

| Control | Detail |
|---|---|
| **Authentication** | JWT, 24h TTL, HS256, `Authorization: Bearer` header |
| **Authorization** | Role check on every mutating endpoint — `before_action :require_commander!` |
| **Rate limiting** | Rack::Attack: 5 login attempts/min, 20/hr; AI endpoints: 10/min, 100/hr; general: 300/min |
| **Auto-ban** | 10+ Rack::Attack violations in 1hr → IP blocked for 1hr |
| **SSE tokens** | Short-lived (60s), `sse_only: true` claim; main JWT rejected on SSE endpoint |
| **Audit log** | Append-only `AuditEvent` records with actor, before/after snapshots — written in same transaction as mutation |
| **SQL injection** | All queries parameterized via ActiveRecord; no string interpolation in queries |
| **Mass assignment** | Explicit `permit()` on all controller params |
| **Static analysis** | Brakeman (0 warnings), bundler-audit (0 CVEs) |

---

## Local Setup

### Prerequisites

- Ruby 3.4+, Bundler 2
- PostgreSQL 16
- Node 22+, Yarn

### Backend

```bash
cd backend
bundle install
cp .env.example .env        # set DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY
rails db:create db:migrate db:seed
RAILS_MAX_THREADS=48 DB_POOL=70 rails server
```

### Frontend

```bash
cd frontend
yarn install
yarn dev                    # → http://localhost:5176 (proxies /api/* to :3000)
```

### Credentials

| Role | Email | Password |
|---|---|---|
| Commander | commander@resilience.mil | password123 |
| Operator | operator@resilience.mil | password123 |

### Optional feed credentials

All five signal types are visible immediately after `db:seed` via demo seeded records. External feeds activate automatically when credentials are present.

| Feed | Env var(s) | Notes |
|---|---|---|
| USGS Seismic | _(none)_ | Always active, public |
| GPSJam | _(none)_ | Always active, public |
| OpenSky (aircraft) | `OPENSKY_USERNAME`, `OPENSKY_PASSWORD` | Optional — runs anonymously with 300s startup delay |
| AIS (vessels) | `AISHUB_USERNAME` | AISHub account |
| FIRMS (wildfire) | `NASA_FIRMS_MAP_KEY` | Free NASA Earthdata key |

---

## Testing

```bash
cd backend
bundle exec rspec --format documentation      # 324 examples, 0 failures
bundle exec brakeman --no-progress -q         # 0 security warnings
bundle exec bundler-audit check               # 0 CVEs

cd frontend
yarn tsc --noEmit                             # 0 TypeScript errors
yarn audit                                    # 0 vulnerabilities
```

Key spec coverage:
- `EvaluatorService` — compound AND/OR rules, direct path, corroboration path, no-fire when corroborating signal absent
- `RuleFiringService` — atomic cooldown (race condition), confidence scoring, action execution, SSE broadcast after commit
- `Alerts::TransitionService` — all valid transitions, all invalid transitions, actor recording, notes, SSE broadcast
- `Tasks::TransitionService` — full state machine, blocked_reason enforcement, resolved_at timestamp
- Request specs — auth guards (401/403 on every protected endpoint), role enforcement, pagination

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

---

## License

MIT
