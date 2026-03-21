# Resilience — Mission Operations Console

> A full-stack operational intelligence platform for managing distributed field operations at scale.
> Built as a portfolio project targeting Palantir, Anduril, and defense-tech companies.

**Live demo → [https://resilience-ops.fly.dev](https://resilience-ops.fly.dev)**

| Role | Email | Password |
|------|-------|----------|
| Commander | commander@resilience.mil | password123 |
| Operator | operator@resilience.mil | password123 |

---

## Quick Start

**Requirements:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (nothing else needed)

```bash
git clone https://github.com/YOUR_USERNAME/resilience.git
cd resilience
docker compose up
```

Open **http://localhost:3000** — demo data is seeded automatically on first run.

> **AI Briefing** (optional): To enable the Claude-powered briefing page, add your Anthropic API key:
> ```bash
> ANTHROPIC_API_KEY=sk-ant-... docker compose up
> ```
> Get a free key at [console.anthropic.com](https://console.anthropic.com/).

---

## What It Demonstrates

Resilience is not a CRUD app with a dark theme. It is built around the same engineering patterns found in real mission-critical platforms:

- **Ontology-first domain model** — `Site`, `Task`, `Asset`, `Vessel`, `ExternalSignal`, `CorrelationRule`, `AreaOfOperation`, `Incident` are first-class entities with identity, state machines, and typed relationships designed to accumulate operational history
- **Server-side state machine enforcement** — transitions are validated in the service layer; `GET /allowed_transitions` tells the UI exactly which buttons to render; Commander-only transitions (resolve, unblock, reopen) are enforced at the backend
- **Immutable append-only audit log** — every mutation writes a `before_snapshot` / `after_snapshot` `AuditEvent` inside the same database transaction; the log cannot diverge from the data
- **Deterministic server-side replay** — sites, tasks, readiness, and audit events accept `?as_of=<ISO>` and reconstruct past state from the audit log; time travel is semantically consistent
- **Intelligence fusion pipeline** — 7 live signal feeds ingested by background threads, evaluated against compound AND/OR correlation rules every 10 seconds, with atomic cooldown enforcement and per-condition confidence scoring
- **Incident ops workspace** — signals fuse into incidents with 5-tab detail view (Evidence, Tasks, Recommendations, Notes, History), assignment ownership, append-only notes log, and an AI recommendation engine that enforces trust-boundary validation before execution
- **Role-based security throughout** — JWT auth (Commander/Operator), short-lived SSE tokens, Rack::Attack rate limiting, trust-boundary validation in all LLM output
- **AI grounding** — Claude briefings receive real `AuditEvent`, `ExternalSignal`, and `SignalRuleMatch` records as context; citation UUIDs are validated client-side; hallucinated IDs are stripped

---

## Features

| Surface | What it does |
|---------|-------------|
| **Dashboard** | Live KPI row, per-site readiness bars, risk badges, task status charts, 30-day throughput chart, Recent Alerts panel with inline triage |
| **Incidents** | Auto-generated from rule firing + geofence breaches; severity inbox with urgency visuals, Mine filter, quick Take/Drop assignment; per-row loading state |
| **Incident Detail** | 5-tab workspace: Evidence (linked alerts), Tasks, AI Recommendations, append-only Notes log, Audit History |
| **Sites** | Inventory with readiness scores, risk score column (LOW/MOD/HIGH/CRIT), color-coded by level |
| **Site Detail** | Risk score history chart (Recharts area + 3 component lines + threshold markers). 6 tabs: Tasks, Signals, Rule Fires, Assets, Audit Trail, Timeline |
| **Site Timeline** | Unified threat timeline merging signal detections, rule fires, task events, site events — chronological spine with kind filter and 30d lookback |
| **Tasks** | Controlled workflow transitions, blocked-reason enforcement, AI natural-language filter, per-task audit timeline |
| **Map** | MapLibre GL — site health markers, AoO polygon overlays, 7 live signal types, vessel track polyline + intel panel, enriched signal detail panel (conflict fatalities, disaster alert level), task transitions from map popups |
| **Globe** | CesiumJS 3D globe with live asset telemetry — asset markers move in real time via SSE (no Cesium Ion required) |
| **Graph** | D3 force-directed object graph showing Site → Task → Asset dependency chains (Palantir ontology pattern) |
| **Signal Feed** | Infinite-scroll virtual list (only ~25 DOM nodes rendered at any scroll position), filterable by all 7 signal types, Commander inject-signal dialog runs correlation engine immediately |
| **Correlation Rules** | Simple or Compound (AND/OR multi-signal) visual rule builder, AO scope selector, dry-run against historical signals, 6 named templates, MITRE ATT&CK technique tagging (12-technique picker, T-code badges) |
| **Areas of Operation** | Geofenced GeoJSON polygon AoOs with threat levels overlaid on map and globe |
| **AI Briefing** | Claude-powered operational summaries grounded in 3 context sources — audit events, nearby signals (200 km/72 h), recent rule fires; citation validation strips hallucinated UUIDs |
| **Recommendations** | AI-generated per-incident/site/alert recommendations; Validator enforces cross-entity payload consistency before any LLM output is persisted or executed |
| **Replay** | Server-side time-travel — scrub any past timestamp, reconstruct operational state from the audit log |
| **Global Search** | `⌘K` cross-entity search across sites, tasks, assets |
| **Real-time** | SSE push — rule fires, alert transitions, task mutations, geofence breaches stream live to all connected clients |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Frontend (React 19)                        │
│   Blueprint.js · TanStack Query · TanStack Virtual              │
│   MapLibre GL · CesiumJS · D3.js · Recharts                     │
│   TypeScript strict · Vite · PWA (Workbox)                      │
└─────────────────────────┬───────────────────────────────────────┘
                          │ JSON REST + SSE
┌─────────────────────────▼───────────────────────────────────────┐
│                      Backend (Rails 8 API)                       │
│   Service layer · JWT · ActionController::Live · Rack::Attack    │
│   PostgreSQL 16 · pgcrypto UUIDs · structure.sql                 │
│   SolidQueue (async jobs) · SolidCache                           │
└──────────┬──────────────────────────────────────────┬───────────┘
           │ background threads                       │ SSE after commit
┌──────────▼────────────────────────────┐  ┌──────────▼───────────┐
│      Intelligence Fusion Pipeline     │  │   Sse::Broadcaster    │
│  OpenSky · USGS · AIS · GPSJam · FIRMS│  │   singleton, typed    │
│  ACLED · GDACS                        │  │   events, thread-safe │
│  → ExternalSignal · Vessel · VesselTrack│
│  → GapDetectionJob (ais_gap signals)  │
│  → BackgroundEvaluator (every 10s)    │
│  → EvaluatorService (compound AND/OR) │
│  → RuleFiringService (atomic cooldown)│
│  → FusionService (incident creation)  │
│  → RecommendationService (AI + guard) │
└───────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, Blueprint.js v6 |
| State / data | TanStack Query v5, TanStack Virtual |
| Maps | MapLibre GL (2D), CesiumJS (3D globe) |
| Charts | Recharts, D3.js |
| Backend | Ruby on Rails 8 (API mode), Puma |
| Database | PostgreSQL 16, pgcrypto UUIDs |
| Jobs | SolidQueue (in-process), SolidCache |
| Real-time | Server-Sent Events (ActionController::Live) |
| Auth | JWT (HS256), short-lived SSE tokens, Rack::Attack |
| AI | Anthropic Claude (grounded summaries + recommendations) |
| Deploy | Docker / Fly.io |

---

## Key Engineering Decisions

**Immutable audit log in the same transaction** — `AuditEvent` records (with `before_snapshot` and `after_snapshot`) are written inside the same `ActiveRecord::Base.transaction` block as the mutation. The audit log is structurally impossible to diverge from the data.

**Atomic cooldown enforcement** — Rule cooldowns are claimed with `UPDATE...WHERE (last_fired_at IS NULL OR last_fired_at <= ?)`. `rows_updated = 0` means cooldown active — no double-fire possible across concurrent workers.

**Compound rules via read-time normalization** — Legacy flat rules are coerced to compound format at read time via `normalized_conditions`. Zero data migration required when compound support was added.

**Confidence scoring formula** — Direct: `proximity_score = 1 − (distance_km / proximity_km)` clamped [0, 1]. Corroboration: `(proximity_score + freshness) / 2`. AND rule → mean. OR rule → max.

**SSE over WebSockets** — Unidirectional, HTTP/2-compatible, no broker or protocol upgrade. Short-lived 60s SSE-only tokens keep the 24h JWT out of server access logs.

**AI trust boundary** — `Recommendations::Validator` checks entity existence, evidence provenance, action payload existence, AND cross-entity consistency (payload IDs must reference the same entity as `affected_entity_*`). LLM-produced recommendations that display Incident A but execute on Incident B are rejected before persistence.

**Virtual list rendering** — Signal Feed uses `@tanstack/react-virtual` — only ~25 DOM nodes rendered at any scroll depth regardless of total count. `useInfiniteQuery` fetches the next page when the last virtual item is within 10 rows of the bottom.

**Risk score snapshots** — Hourly `Risk::SnapshotJob` (SolidQueue recurring) writes `SiteRiskSnapshot` rows. Seeds pre-populate 252 snapshots (28 × 9 sites, every 6 h over 7 days) with per-site trajectory profiles so charts are populated on a fresh `db:seed`.

---

## Signal Feeds

All 7 signal types are visible immediately after first run via demo seeds. Add credentials to enable real-time feeds:

| Feed | Signals | Credentials needed |
|------|---------|-------------------|
| USGS Earthquake | `seismic_event` | None (always live) |
| OpenSky Network | `aircraft_position` | None (anonymous, 300s delay) |
| GDACS | `disaster_alert` | None (always live) |
| GPSJam | `gps_jamming` | None (always live) |
| NASA FIRMS | `wildfire` | Free — [EarthData](https://firms.modaps.eosdis.nasa.gov/api/map_key/) |
| AISHub | `vessel_position` | Free — [AISHub](https://www.aishub.net/join-us) |
| ACLED | `conflict_event` | Free — [ACLED](https://developer.acleddata.com/) |

Add credentials to your `docker compose` invocation as environment variables (see `.env.example` in `backend/`).
