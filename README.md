# Resilience — Mission Operations Console

> A full-stack command-and-control console for managing distributed field operations — built as a portfolio project targeting defense-tech and mission-critical software companies (Anduril, Palantir, Reveal Technology, Rune Technologies).

---

## Demo

<!-- demo.gif -->
> **Live demo:** _deploy in progress_

---

## What It Does

Resilience simulates a real operational console an analyst or commander would use to track field sites, tasks, and assets across a live mission. It is not a CRUD app — it enforces a controlled **workflow state machine**, produces **immutable audit logs**, supports **deterministic time-based replay** of any past operational state, and integrates **AI-powered briefing summaries** grounded to real data.

---

## Feature Overview

| Feature | Description |
|---|---|
| **Dashboard** | Live KPI row, site readiness bars, task status/priority charts, 30-day resolution throughput |
| **Sites** | Tabular site inventory with status tags and readiness scores |
| **Tasks** | Full task management with controlled workflow transitions, blocked-reason enforcement, and audit timeline |
| **Assets** | Asset inventory with type, status, and home site |
| **Map** | MapLibre GL interactive map — click sites to fly in, transition tasks directly from the map |
| **Graph** | D3 force-directed object graph showing site→task→asset dependency chains (Palantir ontology pattern) |
| **Globe** | CesiumJS 3D globe with live asset telemetry — cyan markers move in real time via SSE |
| **Briefing** | Claude-powered AI operational summaries with citations grounded to live task data |
| **Replay** | Server-side time-travel — scrub to any past timestamp and see the full operational state as it existed then |
| **Search** | `⌘K` global cross-entity search across sites, tasks, and assets |
| **Auth** | JWT-based role auth (Commander / Operator) with protected routes |
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
│  PostgreSQL 16 · pgcrypto UUIDs · schema.sql                │
└──────────────────────────────────────────────────────────────┘
```

### Key design decisions

**Server-side replay** (`?as_of=<ISO timestamp>`) — All read endpoints accept `as_of`. The backend reconstructs past state from the audit log rather than replaying events client-side. This keeps the frontend stateless and the replay semantically consistent with how mutations actually happened. See [ADR-001](docs/adr-001-server-side-replay.md).

**Workflow state machine on the backend** — Transition rules (`new → triaged → in_progress ⇄ blocked`, `in_progress → resolved → triaged`) are enforced exclusively on the backend. The frontend fetches `GET /api/tasks/:id/allowed_transitions` and renders only the valid next states. No transition logic lives in the UI.

**Audit log in the same transaction** — Every mutation writes an `AuditEvent` record inside the same DB transaction as the mutation. This guarantees the audit log is never stale or inconsistent with the data it describes.

**Readiness formula** — `score = (resolved/total × 0.6) + (non_blocked/total × 0.4)`. Resolved tasks carry more weight than merely non-blocked ones. Returns `null` for sites with zero tasks.

**SSE over WebSockets** — Server-sent events are unidirectional, HTTP/2-compatible, and require no protocol upgrade. Sufficient for this use case (server → client notifications); simpler to operate than WebSocket infrastructure.

**Zero Ion dependency for CesiumJS** — The 3D globe uses OpenStreetMap tiles (`UrlTemplateImageryProvider`) and an ellipsoid terrain provider. No Cesium Ion token required — the globe loads for anyone who clones the repo.

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
| AI | Anthropic Claude API (via Rails proxy) |
| Real-time | ActionController::Live SSE |
| Auth | JWT (24h TTL, stored in localStorage) |
| PWA | Vite PWA plugin (Workbox, NetworkFirst for `/api/*`) |
| Build | Vite 6, vite-plugin-cesium |
| Testing | RSpec, FactoryBot |

---

## Project Structure

```
resilience/
├── backend/              Rails 8 API-only app
│   ├── app/
│   │   ├── controllers/api/    REST + SSE endpoints
│   │   ├── models/             Site, Task, Asset, AuditEvent, User
│   │   └── services/           ApplicationService, TransitionService,
│   │                           ReadinessCalculationService, AuditEventWriter
│   ├── db/
│   │   ├── structure.sql       Authoritative schema (preserves CHECK constraints)
│   │   └── seeds.rb            5 sites across 3 continents, 3 assets, 10 tasks
│   └── spec/                   RSpec unit tests for services
├── frontend/             React + TypeScript UI
│   ├── src/
│   │   ├── api/                Typed fetch wrappers (tasks, sites, assets, auth, AI)
│   │   ├── components/         AppShell, GlobalSearch, ReplaySelector, ProtectedRoute
│   │   ├── context/            AuthContext, ReplayContext
│   │   ├── hooks/              useEventSource, useTelemetryStream, useOnlineStatus
│   │   └── pages/              Dashboard, Sites, Tasks, Assets, Map, Graph, Globe, Briefing
│   └── vite.config.ts
├── contracts/            OpenAPI 3.1 specification
└── docs/                 Architecture Decision Records
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

---

## API Reference

Full spec: [`contracts/openapi.yaml`](contracts/openapi.yaml)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Exchange credentials for JWT |
| `GET` | `/api/sites` | List sites (supports `?as_of=`) |
| `GET` | `/api/tasks` | List tasks (supports `?as_of=`, `?site_id=`, `?status=`) |
| `POST` | `/api/tasks` | Create task |
| `PUT` | `/api/tasks/:id` | Update task |
| `POST` | `/api/tasks/:id/transition` | Execute workflow transition |
| `GET` | `/api/tasks/:id/allowed_transitions` | Valid next states for a task |
| `GET` | `/api/assets` | List assets |
| `GET` | `/api/readiness` | Per-site readiness scores |
| `GET` | `/api/audit_events` | Immutable audit log |
| `GET` | `/api/analytics/throughput` | Daily resolved task counts (last 30 days) |
| `GET` | `/api/events` | SSE stream — task and readiness push |
| `GET` | `/api/telemetry` | SSE stream — live asset position updates |
| `POST` | `/api/ai/summary` | AI operational briefing (Claude, grounded) |
| `GET` | `/api/ai/filter` | AI natural-language task filter |

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

## Phases Built

| # | Phase | Signal |
|---|---|---|
| 1 | Schema, models, service layer, OpenAPI contract | Architecture |
| 2 | REST endpoints, transition endpoint, audit timeline, replay | Backend depth |
| 3 | Frontend scaffold, Blueprint layout, typed API client | Frontend fundamentals |
| 4 | Audit timeline UI, replay time selector | UX for operator trust |
| 5 | MapLibre GL — interactive geospatial map | Reveal Technology |
| 6 | AI briefing + NL task filter (Claude API, grounded) | Palantir / AI-native |
| 7 | AI citation validation, NL filter, operational summary | AI safety / grounding |
| 8 | AssetsPage, task transitions in drawer | Completeness |
| 9 | JWT auth, React Query, ProtectedRoute, AuthContext | Security |
| 10 | Analytics dashboard — KPIs, readiness, throughput charts | Data visualization |
| 11 | SSE real-time push — tasks and readiness stream live | Anduril / Rune |
| 12 | Map as command surface — transition tasks from the map | Reveal / Anduril |
| 13 | Global `⌘K` search across all entities | Palantir Gotham |
| 14 | PWA — service worker, offline cache, connection banner | Reveal / Rune |
| 15 | Live asset telemetry via SSE — simulated sensor stream | Anduril / Rune |
| 16 | D3 force-directed object graph (ontology view) | Palantir ontology |
| 17 | Responsive mobile layout — bottom nav, card layout | Reveal mobile |
| 18 | CesiumJS 3D globe with live asset telemetry | Anduril |

---

## License

MIT
