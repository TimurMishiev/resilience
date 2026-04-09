# Resilience

**Operational intelligence platform for monitoring distributed field operations, fusing multi-source intelligence, and coordinating tactical response in real time.**

Resilience is the kind of software that runs inside a TOC (Tactical Operations Center). It ingests live sensor feeds, correlates threat patterns, fuses alerts into incidents, and gives operators a single operational picture across 2D map, 3D globe, and structured data surfaces. Every mutation is audit-logged transactionally. Every surface supports time-travel replay. The authorization model enforces organization and area-of-operation boundaries at every layer.

Built as a portfolio project targeting defense-tech engineering roles (Palantir, Anduril, Reveal Technology, Shield AI). The codebase is production-hardened: 2,100+ backend specs, 400+ frontend tests, 13 Playwright E2E scenarios, Pundit authorization on every endpoint, and CI that gates on security scanning, type safety, and performance budgets before auto-deploying.

**Live:** [https://resilience-ops.fly.dev](https://resilience-ops.fly.dev)

| Role | Email | Password |
|------|-------|----------|
| Commander | commander@resilience.mil | password123 |
| Operator | operator@resilience.mil | password123 |
| Viewer | viewer@resilience.mil | password123 |

---

## Quick Start

```bash
git clone https://github.com/TimurMishiev/resilience.git
cd resilience
docker compose up
```

Open **http://localhost:3000**. Demo data is seeded automatically.

> **AI features** require an Anthropic API key:
> ```bash
> ANTHROPIC_API_KEY=sk-ant-... docker compose up
> ```

> **Stopping:** `Ctrl+C`, then `docker compose down`. Add `-v` to reset all data.

---

## Architecture

```
                          ┌──────────────────────────────────────────────┐
                          │            Frontend  (React 19 / TS)        │
                          │  24 pages  ·  57 components  ·  48 hooks   │
                          │  Blueprint.js  ·  MapLibre GL  ·  CesiumJS │
                          └────────────────────┬─────────────────────────┘
                                               │  REST  +  SSE
                          ┌────────────────────▼─────────────────────────┐
                          │           Backend  (Rails 8 API)             │
                          │  28 models  ·  30 policies  ·  65 services  │
                          │  29 controllers  ·  14 jobs  ·  67 migrations│
                          └──┬──────────────────┬───────────────────┬────┘
                             │                  │                   │
               ┌─────────────▼──────┐  ┌───────▼────────┐  ┌──────▼──────────┐
               │  PostgreSQL 17     │  │  SolidQueue    │  │  SSE Broadcaster │
               │  + PostGIS         │  │  22 recurring  │  │  PG LISTEN/      │
               │  UUID PKs          │  │  jobs          │  │  NOTIFY relay    │
               │  structure.sql     │  │                │  │                  │
               └────────────────────┘  └────────────────┘  └──────────────────┘
```

### Signal-to-Action Pipeline

```
External Feeds (7)              Correlation Engine              Operator Workflow
─────────────────     ────────────────────────────     ───────────────────────────
USGS seismic     ─┐                                    ┌─ Alert triage (4-state)
OpenSky aircraft ─┤   ExternalSignal                   ├─ Incident fusion
AISHub vessels   ─┤     │                              ├─ Kill-chain prosecution
NASA FIRMS fire  ─┼───► │ ── Rules (simple/compound) ─┼─ Task assignment
GPSJam jamming   ─┤     │       │                      ├─ AI recommendations
GDACS disasters  ─┤     │       └── Confidence scoring ├─ Operator notes (append-only)
ACLED conflict   ─┘     │                              └─ Full audit trail
                        └── Vessel upsert / gap / loiter
```

1. **Ingest** -- SolidQueue polls 7 feeds on independent schedules (30s to 1h). Each signal is stored as an `ExternalSignal` with type, coordinates, magnitude, and raw payload.
2. **Correlate** -- Every 30 seconds, `Correlations::EvaluateRecentJob` runs all active rules against recent signals. Rules support single conditions, compound AND/OR across signal types, proximity thresholds, and magnitude floors. Cooldown is claimed atomically (`UPDATE ... WHERE last_fired_at <= ?`) so concurrent workers cannot double-fire.
3. **Fuse** -- `FusionService` groups related alerts into incidents. `RuleFiringService` computes confidence scores (proximity + freshness + corroboration). Geofence breaches are detected independently.
4. **Act** -- Operators triage alerts through a 4-state machine (unacknowledged -> acknowledged -> investigating -> closed), work incidents in a 5-tab workspace, and execute AI-generated recommendations that have been validated against real entity references.
5. **Broadcast** -- Every state change fires an SSE event via PostgreSQL `LISTEN`/`NOTIFY` relay. All connected clients update without polling.

---

## Domain Model

| Entity | Purpose |
|--------|---------|
| **Organization** | Tenant boundary. All operational data is org-scoped. |
| **AreaOfOperation** | Geographic polygon with threat posture. Scopes correlation rules, doctrine, and operational data. Org-null AOs are global intelligence overlays. |
| **Site** | Monitored location with status, geofence, readiness score, and risk level. |
| **Asset** | Deployable resource (UAV, sensor, vehicle) with live telemetry stream. |
| **ExternalSignal** | Raw inbound intelligence from any of 7 feed types. |
| **Vessel** | First-class AIS entity with track history, gap detection, and loitering analysis. |
| **CorrelationRule** | Threat pattern matcher -- simple or compound AND/OR conditions with MITRE ATT&CK tagging. |
| **SignalRuleMatch** | Alert -- links signal, rule, and site with confidence score and 4-state workflow. |
| **Incident** | Fused operational event grouping related alerts, with prosecution phases (assessing -> executing -> concluded). |
| **Task** | Actionable work item with priority and 5-state workflow (new -> triaged -> in_progress -> blocked -> resolved). |
| **Recommendation** | AI-generated action with entity-validated evidence chain and accept/reject/defer/execute lifecycle. |
| **AuditEvent** | Immutable before/after snapshot written transactionally with every mutation. |
| **CommanderIntent / PacePlan / SaluteReport / Chokepoint** | Doctrine entities scoped to areas of operation. |

---

## Authorization Model

Four roles with server-enforced Pundit policies on every endpoint:

| Capability | Viewer | Operator | Commander | Admin |
|-----------|--------|----------|-----------|-------|
| Read operational data | Y | Y | Y | Y |
| Task transitions | -- | Own tasks | All tasks | All tasks |
| Alert triage | -- | Y | Y | Y |
| Incident management | -- | Assigned | All | All |
| Create rules / inject signals | -- | -- | Y | Y |
| AI briefing / ontology query | -- | -- | Y | Y |
| Planning doctrine (PACE, intent) | -- | -- | Y | Y |
| Manage users / orgs / sessions | -- | -- | -- | Y |

**Tenant isolation:** Organizations see only their own data. Areas of operation further narrow access for AO-pinned users. Global intelligence domains (signals, vessels) are shared. Doctrine attached to org-null global AOs is hidden from org-scoped users. 30 Pundit policies enforce these boundaries, proven by dedicated org-isolation and scoped-access request specs.

---

## Operational Surfaces

### Dashboard
KPI row (tasks, resolved rate, blocked count, avg readiness), per-site readiness bars with risk badges (LOW/MOD/HIGH/CRIT backed by composite scoring: alert pressure + task health + signal density), 30-day resolution throughput, recent alerts, AI recommendations, and a live loitering watchlist.

### Map (MapLibre GL)
2D operational map rendering sites (risk-colored), assets (status-colored with sensor coverage circles), all 7 signal types, AO polygons (posture-colored), chokepoint overlays (status-colored), geofence breach pulse rings, heatmap density layer, and selected-vessel track trails. Style switcher (tactical/satellite/terrain). Click any entity for an inline detail panel with live data and task transitions.

### Globe (CesiumJS)
3D globe with the same operational data. Sites, assets with live telemetry, signals, AO polygons, chokepoints, coverage circles, breach rings, and vessel tracks. Deep-link selection state shared with the map (`?site_id=`, `?asset_id=`, `?signal_id=`). No Cesium Ion account required.

### Incidents
Inbox sorted by severity with color-coded borders. Filter by status or "Mine" for assigned incidents. Take/Drop ownership inline.

### Incident Detail
5-tab workspace: Evidence (contributing alerts), Tasks (spawned work), Recommendations (AI-generated with evidence drawer), Notes (append-only operational log), History (full audit trail). Kill-chain prosecution workflow with phase tracking (assessing -> executing -> concluded) and append-only prosecution steps with evidence references.

### Signal Feed
Infinite-scroll virtualized table (~25 DOM nodes at any scroll position) showing all ingested signals. Commanders can inject synthetic signals that run the full correlation engine immediately.

### Correlation Rules
Builder for simple and compound (AND/OR) rules with proximity, magnitude, and signal-type conditions. Scoped to AOs. Dry-run against historical signals. 6 one-click templates (Maritime Deception, EW Precursor, etc.). MITRE ATT&CK technique tagging. Effectiveness analytics.

### Alert Triage
Virtualized alert inbox with bulk actions, filtering by status/priority/AO, and inline state transitions. Confidence scores displayed per alert.

### Planning
Unified doctrine surface: SALUTE reports, PACE plans, commander intent, and chokepoints in a single tabbed view scoped to the user's areas of operation.

### AI Briefing
Natural-language operational summary for any site or all sites. Grounded in real audit events, nearby signals (200km/72h), and recent rule fires. Every entity reference the model cites is validated against actual records -- hallucinated IDs are stripped before reaching the UI. Requires Anthropic API key.

### Ontology Query
Commander-only natural-language graph query. Translates a root entity + relation focus into a bounded traversal over the incident/site/task/asset/area graph using Anthropic tool-use. Returns normalized nodes, edges, and counts.

### Replay
Time-travel to any past timestamp. Sites, tasks, alerts, incidents, readiness scores, risk snapshots, doctrine, AO overlays, chokepoint overlays, breach rings, vessel context, recommendations, and audit events all reconstruct historical state. Live-only surfaces (throughput analytics, loitering watchlist, operational health, mutation affordances) are explicitly gated off during replay.

### Other Surfaces
- **Sites** -- table with readiness, risk, status. **Site Detail** -- 6 tabs: tasks, signals, rule fires, assets, audit trail, timeline.
- **Graph** -- D3 force-directed ontology graph (site -> task -> asset dependency chain).
- **Areas of Operation** -- GeoJSON polygon editor with threat posture levels.
- **Swimlane** -- per-site event lane visualization backed by `Analytics::SwimlaneService`.
- **Operational Health** -- commander-only dashboard of feed health, job status, and relay liveness snapshots.
- **Security** -- session inventory with per-session revocation and bulk "sign out all devices".
- **Users / Organizations** -- admin-only management surfaces.
- **Command palette** (Cmd+K) -- global search across sites, tasks, and assets.
- **Batch export** -- CSV/JSON export with per-page filter passthrough for sites, tasks, signals, alerts, incidents, recommendations, and areas.
- **Offline detection** -- disables mutations and shows reconnection banner on connectivity loss.

---

## Real-Time Architecture

SSE (Server-Sent Events) with PostgreSQL `LISTEN`/`NOTIFY` relay for cross-process fan-out.

**Admission control:** `SseStreamLease` table with PostgreSQL advisory lock for atomic stream admission. Per-user cap (4 streams), per-IP cap (12 streams), lease-based expiry with heartbeat refresh. `Rack::Attack` throttles SSE token minting and reconnect storms.

**Thread budget:** SSE streams permanently occupy a Puma thread. Production budget: 20 threads total, 12 max SSE, 8 reserved for API. Documented in `puma.rb` with the full constraint chain.

**Streams:** `/api/events` (operational events), `/api/signals/stream` (signal firehose), `/api/telemetry/stream` (asset telemetry). Each uses a short-lived SSE token (60s) fetched just before connection -- the long-lived JWT never appears in a URL.

---

## Test Coverage

| Layer | Count | Tool |
|-------|-------|------|
| Backend specs | 2,105 | RSpec |
| Frontend unit/integration | 407 (62 files) | Vitest |
| E2E critical paths | 13 scenarios | Playwright |
| Security scanning | 0 warnings | Brakeman + bundler-audit |
| Type safety | 0 errors | TypeScript strict |
| Lint | 0 errors | ESLint |
| Performance budget | Globe reconcile benchmark | Playwright + CI gate |

Key test categories:
- **Org isolation specs** -- prove every Pundit scope restricts records to the correct tenant
- **Scoped access request specs** -- prove API-level enforcement of org/AO boundaries including global AO doctrine hiding
- **Adversarial correlation specs** -- 12 edge cases for the correlation engine
- **Replay parity specs** -- prove historical state reconstruction across operational surfaces
- **Role boundary E2E** -- Playwright tests proving commander/operator/viewer permission boundaries end-to-end

---

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | React 19, TypeScript, Vite | Type safety, fast HMR, modern concurrent patterns |
| UI | Blueprint.js v6 | Dense operational UI components built for data-heavy applications |
| Server state | TanStack Query v5 | Cache invalidation, background refetch, optimistic updates, infinite scroll |
| 2D map | MapLibre GL | Open-source, no API key, handles large feature sets with WebGL |
| 3D globe | CesiumJS | Open-source 3D geospatial, no Ion account required |
| Charts | Recharts + D3.js | Composable chart components + custom force-directed graph |
| Backend | Ruby on Rails 8.1 (API mode) | Service-object architecture, fast to build correct systems |
| Database | PostgreSQL 17 + PostGIS | UUID PKs, `structure.sql`, spatial queries (`ST_DWithin`), partial indexes |
| Background jobs | SolidQueue | In-process, no Redis dependency, recurring schedule via `recurring.yml` |
| Real-time | SSE + PG LISTEN/NOTIFY | Unidirectional push, cross-process relay, HTTP/2 compatible |
| Auth | JWT + bcrypt + Pundit + Rack::Attack | Stateless tokens, per-session revocation via `jti`, 30 authorization policies |
| AI | Anthropic Claude (tool-use) | Grounded summaries, ontology queries, recommendations with circuit breaker |
| Observability | Sentry (optional) + `OperationalStatus` | Error tracking + DB-backed health snapshots for jobs and feeds |
| CI/CD | GitHub Actions -> Fly.io | 5-job pipeline: frontend, backend security, backend tests, perf benchmark, E2E. Auto-deploy on green. |

---

## CI Pipeline

```
push to main
  ├── Frontend: tsc + ESLint + Vitest + build
  ├── Backend Security: Brakeman + bundler-audit
  ├── Backend Tests: RSpec (2,105 examples against PostGIS 17)
  ├── Globe Benchmark: Playwright perf budget against Dockerized app
  └── E2E: Playwright critical paths against Dockerized app
        │
        └── all green ──► Deploy to Fly.io (automatic)
```

---

## Development Setup

**Requirements:** Ruby 3.4.7, Node.js 22.13+, Yarn, PostgreSQL 17 with PostGIS.

```bash
# Backend
cd backend
bundle install
cp .env.example .env          # fill in SECRET_KEY_BASE (run: bin/rails secret)
bin/rails db:create db:migrate db:seed

# Start backend
RAILS_MAX_THREADS=48 bundle exec rails server

# Frontend (separate terminal)
cd frontend
yarn install
yarn dev
```

Open **http://localhost:5176**.

**Running tests:**

```bash
# Backend
cd backend
bundle exec rspec                          # 2,105 examples
bundle exec brakeman --no-progress -q      # security scan
bundle exec bundler-audit check            # CVE check

# Frontend
cd frontend
npx tsc --noEmit                           # type check
yarn lint                                  # ESLint
npx vitest run                             # 407 tests
yarn build                                 # production build
```

---

## Live Signal Feeds

| Signal Type | Source | Credentials | Poll Interval |
|-------------|--------|-------------|---------------|
| Seismic | USGS Earthquake Hazards | None | 5 min |
| Aircraft | OpenSky Network | None | 15 min |
| Disaster alerts | GDACS | None | 15 min |
| GPS jamming | GPSJam.org | None | 15 min |
| Wildfire | NASA FIRMS | Free key | 15 min |
| Vessel positions | AISHub | Free account | 30 sec |
| Conflict events | ACLED | Free account | 1 hour |

All 7 signal types appear immediately via seeded demo data regardless of credentials.

```bash
# With optional feed credentials
NASA_FIRMS_MAP_KEY=your-key AISHUB_USERNAME=your-user docker compose up
```

---

## Key Engineering Decisions

**Transactional audit log.** Every mutation writes an `AuditEvent` with `before_snapshot` and `after_snapshot` in the same database transaction. The audit trail is structurally impossible to diverge from the data.

**Atomic cooldown claim.** Rule cooldowns use `UPDATE ... WHERE last_fired_at <= ?`. If `rows_updated = 0`, the cooldown is still active. Two concurrent workers cannot double-fire because only one UPDATE can win the row lock.

**Compound rules with zero migration.** When AND/OR multi-signal rules were added, existing flat rules were not migrated. They coerce to compound format at read time via `normalized_conditions`. The discriminator is the presence of an `operator` key.

**AI trust boundary.** `Recommendations::Validator` runs four checks before saving any LLM-produced recommendation: (1) surfaced entity exists, (2) each evidence item exists, (3) action payload IDs exist, (4) payload IDs refer to the same entity as the surfaced entity. Check 4 prevents the model from displaying "Incident A" in the UI while carrying "Incident B" in the executable payload.

**AI circuit breaker.** All Anthropic-backed services share a circuit breaker (3-failure threshold, 2-minute open window) with explicit timeouts, zero retries, env-overridable model selection, and observability capture.

**Named tenant boundary helpers.** `area_of_operation_surface_accessible?` (AO catalog reads -- includes global AOs) vs `owned_area_of_operation_accessible?` (doctrine/operational data -- org-owned only). Every policy uses the named helper, never the raw flag. Matching Scope helpers enforce the same boundary at the collection level.

**SSE token isolation.** The browser's `EventSource` API cannot send custom headers. Instead of putting the JWT in the URL, the frontend fetches a 60-second SSE-only token from `POST /api/sse_token` immediately before opening the stream. The long-lived JWT never appears in server access logs or browser history.

**Virtualized feed rendering.** The signal feed and alert triage use `@tanstack/react-virtual`. Regardless of total row count, ~25 DOM nodes are rendered at any scroll position. `useInfiniteQuery` fetches the next page when the scroll position approaches the boundary.

**Budgeted globe benchmark.** A Playwright benchmark measures the focused-to-global signal reconcile path against the Dockerized production app. CI fails if mean, p95, or worst sample breaches the budget. Performance is an enforced release bar, not a manual check.

---

## Project Structure

```
resilience/
├── compose.yml                    # One-command local run
├── Dockerfile                     # Multi-stage: frontend build -> Rails -> production image
├── .github/workflows/ci.yml      # 5-job CI pipeline with auto-deploy
│
├── frontend/                      # React 19 + TypeScript + Vite
│   ├── src/
│   │   ├── api/                   # 24 API client modules
│   │   ├── components/            # 57 shared components (map/, dashboard/, shell/)
│   │   ├── context/               # AuthContext, ReplayContext
│   │   ├── hooks/                 # 48 hooks (data, engine, telemetry, replay)
│   │   ├── pages/                 # 24 page components
│   │   ├── lib/                   # Utilities (colors, coverage, formatters, signals)
│   │   └── test/                  # 62 Vitest test files
│   └── e2e/                       # 13 Playwright E2E scenarios
│
└── backend/                       # Rails 8.1 API
    ├── app/
    │   ├── controllers/api/       # 29 API controllers
    │   ├── models/                # 28 ActiveRecord models
    │   ├── policies/              # 30 Pundit authorization policies
    │   ├── services/              # 65 service objects
    │   └── jobs/                  # 14 background jobs
    ├── config/
    │   └── recurring.yml          # 22 SolidQueue recurring job schedules
    ├── db/
    │   ├── migrate/               # 67 migrations
    │   └── structure.sql          # Committed PostGIS-aware schema
    └── spec/                      # 2,105 RSpec examples
```

---

## License

MIT
