# Resilience — Mission Operations Console

> A full-stack command-and-control console for managing distributed field operations — built as a portfolio project targeting defense-tech and mission-critical software companies (Anduril, Palantir, Reveal Technology, Rune Technologies).

---

## Demo

<!-- demo.gif -->
> **Live demo:** _deploy in progress_

---

## What It Does

Resilience simulates a real operational console an analyst or commander would use to track field sites, tasks, and assets across a live mission. It is not a CRUD app — it enforces a controlled **workflow state machine**, produces **immutable audit logs**, supports **deterministic time-based replay** of any past operational state, integrates **AI-powered briefing summaries** grounded to real data, and fuses **live external intelligence feeds** (aircraft, seismic, vessel, GPS jamming, wildfire) into a **correlation rules engine** that auto-generates tasks when real-world signals match defined threat patterns.

---

## Feature Overview

| Feature | Description |
|---|---|
| **Dashboard** | Live KPI row, site readiness bars, task status/priority charts, 30-day resolution throughput |
| **Sites** | Tabular site inventory with status tags and readiness scores |
| **Tasks** | Full task management with controlled workflow transitions, blocked-reason enforcement, and audit timeline |
| **Assets** | Asset inventory with type, status, and home site |
| **Map** | MapLibre GL interactive map — site health markers, AoO polygon overlays, live signal layer (color-coded by type), transition tasks directly from the map |
| **Graph** | D3 force-directed object graph showing site→task→asset dependency chains (Palantir ontology pattern) |
| **Globe** | CesiumJS 3D globe with live asset telemetry — markers move in real time via SSE |
| **Signal Feed** | Live table of ingested external signals — aircraft positions, seismic events, vessel tracks, GPS jamming, wildfires — with source/type filtering |
| **Correlation Rules** | CRUD rule builder — define proximity, magnitude, count thresholds and time windows; rules auto-create tasks when signals match |
| **Areas of Operation** | Geofenced AoO polygons with threat levels (green/amber/red/black) overlaid on the map and globe |
| **Briefing** | Claude-powered AI operational summaries with citations grounded to live audit data |
| **Replay** | Server-side time-travel — scrub to any past timestamp and see the full operational state as it existed then |
| **Search** | `⌘K` global cross-entity search across sites, tasks, and assets |
| **Auth** | JWT-based role auth (Commander / Operator) with protected routes and role-gated UI |
| **Real-time** | SSE push — task mutations and readiness scores stream live to all connected clients |
| **Offline / PWA** | Service worker caches API responses, offline banner, installable on desktop/mobile |
| **Mobile** | Fully responsive — bottom tab bar, card layout, bottom-sheet drawer on small screens |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Frontend (React)                      │
│  Blueprint.js · React Query · MapLibre · CesiumJS · D3.js   │
│  Recharts · Vite · TypeScript (strict) · PWA (Workbox)      │
└────────────────────────┬─────────────────────────────────────┘
                         │ JSON + SSE over HTTP
┌────────────────────────▼─────────────────────────────────────┐
│                     Backend (Rails 8)                        │
│  API-only · Service layer · JWT auth · ActionController::Live│
│  PostgreSQL 16 · pgcrypto UUIDs · structure.sql             │
└────────────────────────┬─────────────────────────────────────┘
                         │ polling threads
┌────────────────────────▼─────────────────────────────────────┐
│              Intelligence Fusion Pipeline                    │
│  OpenSky (aircraft) · USGS Seismic · AIS (vessels)          │
│  GPSJam · FIRMS Wildfire · Correlation Engine               │
└──────────────────────────────────────────────────────────────┘
```

### Key design decisions

**Server-side replay** (`?as_of=<ISO timestamp>`) — All read endpoints accept `as_of`. The backend reconstructs past state from the audit log rather than replaying events client-side. This keeps the frontend stateless and the replay semantically consistent with how mutations actually happened. See [ADR-001](docs/adr-001-server-side-replay.md).

**Workflow state machine on the backend** — Transition rules (`new → triaged → in_progress ⇄ blocked`, `in_progress → resolved → triaged`) are enforced exclusively on the backend. The frontend fetches `GET /api/tasks/:id/allowed_transitions` and renders only the valid next states. No transition logic lives in the UI.

**Audit log in the same transaction** — Every mutation writes an `AuditEvent` record inside the same DB transaction as the mutation. This guarantees the audit log is never stale or inconsistent with the data it describes.

**Readiness formula** — `score = (resolved/total × 0.6) + (non_blocked/total × 0.4)`. Resolved tasks carry more weight than merely non-blocked ones. Returns `null` for sites with zero tasks.

**SSE over WebSockets** — Server-sent events are unidirectional, HTTP/2-compatible, and require no protocol upgrade. Sufficient for this use case (server → client notifications); simpler to operate than WebSocket infrastructure.

**Zero Ion dependency for CesiumJS** — The 3D globe uses OpenStreetMap tiles (`UrlTemplateImageryProvider`) and an ellipsoid terrain provider. No Cesium Ion token required — the globe loads for anyone who clones the repo.

**Correlation engine with spatial reasoning** — Rules evaluate incoming signals using Haversine distance, count thresholds over configurable time windows, magnitude floors, and per-rule cooldowns. A bounding-box SQL pre-filter keeps queries fast; exact distance is computed in Ruby. Rules are scoped to an Area of Operation or a specific site.

**AI grounding with citation validation** — The Claude-powered briefing passes real `AuditEvent` records as context. Every citation UUID the model returns is validated against the set of IDs provided — hallucinated IDs are silently stripped. The model cannot invent events.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Ruby on Rails 8.1, PostgreSQL 16, Ruby 3.4 |
| Frontend | React 19, TypeScript (strict), Blueprint.js 6 |
| State / Data | React Query 5, React Context |
| Maps | MapLibre GL JS |
| Globe | CesiumJS 1.139 (OSM tiles, zero Ion dependency) |
| Graph | D3.js v7 force simulation |
| Charts | Recharts |
| AI | Anthropic Claude API — claude-haiku-4-5 (via Rails proxy) |
| Real-time | ActionController::Live SSE |
| Auth | JWT (24h TTL, stored in localStorage) |
| PWA | Vite PWA plugin (Workbox, NetworkFirst for `/api/*`) |
| Build | Vite 6, vite-plugin-cesium |
| Testing | RSpec, FactoryBot, Brakeman, bundler-audit |
| CI | GitHub Actions (typecheck, lint, build, security audit, RSpec) |

---

## Project Structure

```
resilience/
├── backend/              Rails 8 API-only app
│   ├── app/
│   │   ├── controllers/api/    REST + SSE endpoints (16 controllers)
│   │   ├── models/             Site, Task, Asset, AuditEvent, User,
│   │   │                       ExternalSignal, CorrelationRule,
│   │   │                       SignalRuleMatch, AreaOfOperation
│   │   └── services/
│   │       ├── tasks/          CreationService, TransitionService, UpdateService
│   │       ├── signals/        IngestService
│   │       ├── feeds/          OpenSkyIngestionService, UsgsSeismicIngestionService,
│   │       │                   AisIngestionService, GpsjamIngestionService,
│   │       │                   FirmsWildfireIngestionService
│   │       ├── correlations/   EvaluatorService, RuleFiringService, BackgroundEvaluator
│   │       ├── ai/             SummaryService, FilterService
│   │       ├── readiness/      CalculationService
│   │       ├── replay/         ProjectionService
│   │       ├── sse/            Broadcaster
│   │       └── telemetry/      SimulatorService
│   ├── db/
│   │   ├── structure.sql       Authoritative schema (preserves CHECK constraints)
│   │   └── seeds.rb            9 sites across 4 theaters, 7 assets, 19 tasks,
│   │                           5 Areas of Operation, 5 correlation rules
│   └── spec/                   RSpec unit + request specs
├── frontend/             React + TypeScript UI
│   ├── src/
│   │   ├── api/                Typed fetch wrappers for all resources
│   │   ├── components/         AppShell, GlobalSearch, ReplaySelector,
│   │   │                       AuditTimeline, BriefingPanel, ProtectedRoute
│   │   ├── context/            AuthContext, ReplayContext
│   │   ├── hooks/              useEventSource, useTelemetryStream, useOnlineStatus,
│   │   │                       useSignals, useCorrelationRules, useAreasOfOperation,
│   │   │                       useSignalRuleMatches
│   │   └── pages/              Dashboard, Sites, Tasks, Assets, Map, Graph,
│   │                           Globe, Briefing, SignalFeed, CorrelationRules, Areas
│   └── vite.config.ts
├── contracts/            OpenAPI 3.1 specification
├── docs/                 Architecture Decision Records
└── .github/workflows/    CI pipeline (ci.yml)
```

---

## Local Setup

### Prerequisites
- Ruby 3.4+, Bundler
- PostgreSQL 16
- Node 20+, Yarn

### Backend

```bash
cd backend
bundle install
cp .env.example .env          # set DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY
rails db:create db:migrate db:seed
rails server                  # → http://localhost:3000
```

### Frontend

```bash
cd frontend
yarn install
yarn dev                      # → http://localhost:5173
```

### Seed credentials

| Role | Email | Password |
|---|---|---|
| Commander | commander@resilience.mil | password |
| Operator | operator@resilience.mil | password |

### Optional feed credentials

External intelligence feeds are disabled when credentials are absent — the app runs fully without them.

| Feed | Env vars | Notes |
|---|---|---|
| OpenSky (aircraft) | `OPENSKY_USERNAME`, `OPENSKY_PASSWORD` | Free account at opensky-network.org |
| AIS (vessels) | `AISHUB_USERNAME` | AISHub account required |
| FIRMS (wildfire) | `NASA_FIRMS_MAP_KEY` | Free NASA Earthdata key |
| USGS Seismic | _(none)_ | Public feed, always active |
| GPSJam | _(none)_ | Public feed, always active |

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Exchange credentials for JWT |
| `GET` | `/api/sites` | List sites (supports `?as_of=`) |
| `GET` | `/api/tasks` | List tasks (supports `?as_of=`, `?site_id=`, `?status=`, `?priority=`) |
| `POST` | `/api/tasks` | Create task |
| `PATCH` | `/api/tasks/:id` | Update task attributes |
| `POST` | `/api/tasks/:id/transition` | Execute workflow transition |
| `GET` | `/api/tasks/:id/allowed_transitions` | Valid next states for a task |
| `GET` | `/api/assets` | List assets |
| `GET` | `/api/readiness` | Per-site readiness scores (supports `?as_of=`) |
| `GET` | `/api/audit_events` | Immutable audit log |
| `GET` | `/api/analytics/throughput` | Daily resolved task counts (last 30 days) |
| `GET` | `/api/events` | SSE stream — task and readiness push |
| `GET` | `/api/telemetry` | SSE stream — live asset position updates |
| `POST` | `/api/ai/summary` | AI operational briefing (Claude, grounded) |
| `GET` | `/api/ai/filter` | AI natural-language task filter |
| `GET` | `/api/signals` | External signal feed (filterable by source, type, proximity) |
| `GET/POST/PATCH/DELETE` | `/api/correlation_rules` | Manage correlation rules |
| `GET` | `/api/signal_rule_matches` | Rule firing history with signal + task linkage |
| `GET/POST/PATCH/DELETE` | `/api/areas_of_operation` | Manage geofenced AoOs |

---

## Workflow State Machine

```
         ┌─────────┐
         │   new   │
         └────┬────┘
              │
         ┌────▼────┐
         │ triaged │◄──────────────────┐
         └────┬────┘                   │
              │                        │
       ┌──────▼────────┐               │
       │  in_progress  │               │
       └──┬────────┬───┘               │
          │        │                   │
    ┌─────▼──┐  ┌──▼──────┐           │
    │blocked │  │resolved │───────────►┘
    └─────┬──┘  └─────────┘
          │
          └──► in_progress
```

Transitions are enforced server-side. `blocked` requires a `blocked_reason` string. `resolved` records a `resolved_at` timestamp.

---

## Intelligence Fusion Pipeline

```
External feeds (background threads)
  ├── OpenSky Network     → aircraft_position signals  (every 15 min, 4 theaters)
  ├── USGS Earthquake     → seismic_event signals      (every 5 min, M2.5+ global)
  ├── AISHub              → vessel_position signals    (every 15 min)
  ├── GPSJam              → gps_jamming signals        (every 15 min)
  └── NASA FIRMS          → wildfire signals           (every 15 min)
           │
           ▼
  ExternalSignal (Postgres)
           │
           ▼
  BackgroundEvaluator (every 10s)
           │
           ▼
  EvaluatorService — for each active CorrelationRule:
    ├── signal_type match
    ├── Haversine proximity check (bounding-box SQL pre-filter)
    ├── count threshold over time window
    ├── magnitude floor
    └── cooldown guard
           │ match
           ▼
  RuleFiringService
    ├── Tasks::CreationService → auto-creates Task
    ├── SignalRuleMatch record (signal ↔ rule ↔ site ↔ task)
    └── rule.last_fired_at updated (cooldown)
```

---

## Build Phases

| Phase | What was built |
|---|---|
| 1 | Schema, models, service layer, OpenAPI contract |
| 2 | REST endpoints, transition endpoint, audit timeline, server-side replay |
| 3 | Frontend scaffold, Blueprint layout, typed API client |
| 4 | Audit timeline UI, replay time selector |
| 5 | MapLibre GL — interactive geospatial map |
| 6–7 | AI briefing + NL filter (Claude API, grounded, citation-validated) |
| 8 | AssetsPage, task transitions in map/drawer |
| 9 | JWT auth, React Query, ProtectedRoute, role-based UI |
| 10 | Analytics dashboard — KPIs, readiness bars, throughput charts |
| 11 | SSE real-time push — tasks and readiness stream live |
| 12 | Map as command surface — transition tasks from the map |
| 13 | Global `⌘K` search across all entities |
| 14 | PWA — service worker, offline cache, connection banner |
| 15 | Live asset telemetry via SSE — simulated sensor stream |
| 16 | D3 force-directed object graph (Palantir ontology pattern) |
| 17 | Responsive mobile layout — bottom nav, card layout |
| 18 | CesiumJS 3D globe with live asset telemetry |
| A | OpenSky live aircraft feed + correlation engine (backend) |
| B | Correlation Rules UI — CRUD, recent firings, role-gated |
| C | Areas of Operation — geofenced polygons, threat levels, map overlays |
| D | Multi-feed intelligence fusion — USGS, AIS, GPSJam, FIRMS Wildfire |
| E | Signal layer on the map — color-coded circles, toggle, info panel |

---

## License

MIT
