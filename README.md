# Resilience — Mission Operations Console

**A full-stack operational intelligence platform for monitoring distributed field operations in real time.**

Built as a portfolio project targeting defense-tech companies (Palantir, Anduril, Reveal Technology). Resilience demonstrates the kind of engineering patterns found in real mission-critical software: audit-safe data models, server-enforced state machines, real-time intelligence fusion, and AI grounded to real operational data.

🔗 **Live demo: [https://resilience-ops.fly.dev](https://resilience-ops.fly.dev)**

| Role | Email | Password | Access |
|------|-------|----------|--------|
| Commander | commander@resilience.mil | password123 | Full read/write — rules, signals, AI, site management |
| Operator | operator@resilience.mil | password123 | Task management, alert triage, incident workspace |

---

## Quick Start

The only thing you need is [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
git clone https://github.com/YOUR_USERNAME/resilience.git
cd resilience
docker compose up
```

Open **[http://localhost:3000](http://localhost:3000)**.

Demo data (sites, tasks, signals, rules, incidents, vessels, risk scores) is seeded automatically on first run. Live signal feeds start immediately — you'll see seismic events, aircraft positions, and disaster alerts populating the map within seconds.

> **Want AI briefings?** Add an Anthropic API key (free at [console.anthropic.com](https://console.anthropic.com)):
> ```bash
> ANTHROPIC_API_KEY=sk-ant-... docker compose up
> ```

> **Stopping:** `Ctrl+C` in the terminal, then `docker compose down` to remove containers. Your data is preserved in a Docker volume — run `docker compose down -v` to reset everything.

---

## What Is Resilience?

Imagine you're running a network of 9 field sites across multiple regions. Each site has assets deployed, tasks assigned to operators, and a constant stream of intelligence signals coming in — aircraft approaching, seismic activity, GPS jamming, vessels going dark.

Resilience is the operations console that ties it all together:

- **You see everything in one place** — a live map showing all 7 signal types, site health, asset positions, and geofenced areas of operation
- **The system watches for threats automatically** — correlation rules fire when signals match dangerous patterns (e.g. "GPS jamming within 100km of a site AND aircraft approaching within 50km"), generating alerts and tasks without manual intervention
- **Incidents are created and tracked** — when rules fire, signals are fused into incidents. Operators take ownership, add notes, and work through a structured 5-tab workspace
- **Every action is auditable** — every state change writes an immutable before/after snapshot. You can time-travel back to any past moment and see exactly what the operational picture looked like
- **The AI knows what's real** — the briefing and recommendation engine are grounded in actual audit events, signal records, and rule fires. Hallucinated references are rejected before they reach the UI

The two roles reflect how real ops teams work:
- **Commander** — sets the rules, manages sites, injects signals, reviews AI briefings, resolves incidents
- **Operator** — triages alerts, owns tasks, takes incident assignments, adds operational notes

---

## Features

### Dashboard
Your operational overview at a glance. A live KPI row shows total incidents, active alerts, task completion rates, and site readiness scores. Each site gets a risk badge (LOW / MODERATE / HIGH / CRITICAL) with a tooltip that breaks down exactly why the score is what it is — alert pressure, task health, and nearby signal density. A 30-day resolution throughput chart shows how the team has been performing.

### Incidents
Incidents are created automatically when correlation rules fire or geofence boundaries are breached. The inbox shows every open incident sorted by severity with color-coded left borders (red = critical, amber = high). Operators can filter to "Mine" to see only their assigned incidents and use Take/Drop buttons to claim or release ownership without leaving the list view.

### Incident Detail
A full 5-tab workspace for working an incident:
- **Evidence** — all the alerts (rule fires) that contributed to this incident
- **Tasks** — tasks spawned from those alerts
- **Recommendations** — AI-generated action recommendations specific to this incident
- **Notes** — append-only operational log (notes can never be edited or deleted — the log is the record)
- **History** — full audit trail of every change made to this incident

### Sites
All 9 monitored sites in one table with readiness scores, risk levels, and status tags. Click any site to open its detail view.

### Site Detail
Six tabs of operational data for a single site:
- **Tasks** — create and manage tasks directly from the site view
- **Signals** — all signals detected within proximity of this site
- **Rule Fires** — every correlation rule that fired against this site, with confidence scores and inline triage buttons
- **Assets** — assets assigned to this site
- **Audit Trail** — complete history of every change made to this site
- **Timeline** — a unified chronological threat timeline that merges signals, rule fires, task events, and site changes into a single scrollable spine

### Map
An interactive 2D map (MapLibre GL) showing everything at once:
- Site markers color-coded by risk level
- All 7 signal types as colored dots (aircraft = blue, seismic = orange, vessel = green, GPS jam = yellow, wildfire = red, conflict = purple, disaster = pink)
- Areas of Operation as colored polygons (green / amber / red / black by threat level)
- Click a vessel signal to see its full track history as a dashed polyline with an intel panel showing MMSI, type, flag, speed, and dark/loitering status
- Click a site marker to see its risk score, open tasks, and transition task status directly from the map popup

### Globe
A 3D globe (CesiumJS) showing live asset telemetry. Asset markers move in real time as their GPS positions update via SSE. No Cesium Ion account required — uses OpenStreetMap tiles.

### Signal Feed
All incoming signals in a filterable infinite-scroll table. The list handles thousands of rows without performance issues — only ~25 DOM nodes are rendered at any scroll position. Commanders can inject synthetic signals through a dialog that runs the full correlation engine immediately, which is useful for testing rules.

### Correlation Rules
The engine that watches for threats. You can build:
- **Simple rules** — one signal type, proximity threshold, magnitude minimum
- **Compound rules** — AND/OR logic across multiple signal types (e.g. GPS jamming AND aircraft approach = elevated threat)

Each rule can be scoped to a specific Area of Operation so it only fires for sites within that AO. Rules support:
- **Dry run** — test against historical signals before activating
- **Templates** — 6 pre-built scenarios (Maritime Deception, EW Precursor, Humanitarian Crisis, etc.) that pre-fill the form with one click
- **MITRE ATT&CK tagging** — attach technique codes (T1590, T0879, etc.) to each rule for classification and reporting

### AI Briefing
Ask Claude for an operational summary of any site (or all sites). The briefing is grounded in three real data sources — recent audit events, nearby intelligence signals (within 200km over 72 hours), and recent rule fires. Every UUID the model cites is validated against the actual records provided; hallucinated IDs are stripped before the response reaches you. Requires an Anthropic API key.

### Replay
Scrub backward in time to any past timestamp. Sites, tasks, readiness scores, and audit events all reconstruct their state as of that moment from the audit log. Useful for incident post-mortems — "what did the operational picture look like when this incident started?"

### Other
- **Graph view** — D3 force-directed graph showing the Site → Task → Asset dependency chain (Palantir ontology pattern)
- **Areas of Operation** — draw GeoJSON polygon boundaries with threat levels that scope correlation rules and appear on map and globe
- **⌘K Global search** — search across sites, tasks, and assets instantly
- **Real-time updates** — rule fires, alert transitions, task changes, and geofence breaches push instantly to all connected clients via SSE. No polling.
- **Offline banner** — detects loss of connectivity and disables mutations until the connection is restored
- **Responsive** — bottom tab bar, card layout, and drawer navigation on mobile screens

---

## How It Works

### The Big Picture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Frontend (React 19)                        │
│   Blueprint.js · TanStack Query · MapLibre GL · CesiumJS        │
│   TypeScript · Vite · PWA                                        │
└─────────────────────────┬───────────────────────────────────────┘
                          │ REST API + Server-Sent Events
┌─────────────────────────▼───────────────────────────────────────┐
│                      Backend (Rails 8 API)                       │
│   Service objects · JWT auth · PostgreSQL 16 · SolidQueue        │
└──────────┬──────────────────────────────────────────┬───────────┘
           │ background threads                       │ push events
┌──────────▼────────────────────────────┐  ┌──────────▼───────────┐
│      Intelligence Fusion Pipeline     │  │   SSE Broadcaster     │
│  7 live feeds → signals → rules       │  │   live updates to     │
│  → alerts → incidents → AI recs       │  │   all clients         │
└───────────────────────────────────────┘
```

### Signal → Alert → Incident flow

1. **Signal ingested** — a background thread polls an external feed (USGS, OpenSky, etc.) every few minutes and stores new signals as `ExternalSignal` records
2. **Rules evaluated** — every 10 seconds, the correlation engine checks all active rules against recent signals. A rule fires when its conditions are met (signal type + proximity + magnitude threshold)
3. **Alert created** — a `SignalRuleMatch` record is created linking the signal, the rule, and the site. This is the "alert" — it starts in UNACKNOWLEDGED state
4. **Incident fused** — `FusionService` either opens a new incident or adds the alert to an existing open incident for that site. This is how related alerts get grouped into a single operational event
5. **SSE broadcast** — after the database transaction commits, an SSE event pushes to all connected clients. Their screens update without any polling
6. **Operator works the incident** — takes ownership, triages the alerts, adds notes, works through the recommendation queue

### Security model

- All API endpoints require a JWT. Tokens are 24 hours, issued on login.
- SSE connections use a separate short-lived token (60 seconds) fetched just before opening the EventSource. This keeps the long-lived JWT out of server access logs and browser history.
- Commanders and Operators have different permissions enforced server-side. The API exposes `GET /allowed_transitions` so the UI only shows buttons for actions the current user is actually allowed to take.
- Rate limiting is enforced by Rack::Attack on all endpoints.

---

## Tech Stack

| | Technology | Why |
|-|-----------|-----|
| **Frontend** | React 19, TypeScript, Vite | Type safety, fast builds, modern React patterns |
| **UI components** | Blueprint.js v6 | Dense, data-rich UI components built for operational software |
| **Server state** | TanStack Query v5 | Cache management, refetch intervals, optimistic updates |
| **Maps** | MapLibre GL (2D), CesiumJS (3D) | Open-source, no token required, handles large feature sets |
| **Charts** | Recharts, D3.js | Composable charts and custom force-directed graph |
| **Backend** | Ruby on Rails 8 (API mode) | Fast to build correct things; service layer pattern scales cleanly |
| **Database** | PostgreSQL 16 | UUID PKs via pgcrypto, structure.sql, partial unique indexes |
| **Background jobs** | SolidQueue | In-process async jobs, no Redis needed |
| **Real-time** | Server-Sent Events | Simpler than WebSockets for unidirectional push; HTTP/2 compatible |
| **Auth** | JWT + Rack::Attack | Stateless tokens, short-lived SSE tokens, rate limiting |
| **AI** | Anthropic Claude | Grounded operational summaries and actionable recommendations |
| **Deploy** | Docker + Fly.io | Single-image compose for local; Fly for production |

---

## Development Setup (without Docker)

If you want to run the app locally for development:

**Requirements**
- Ruby 3.4.7 (use [rbenv](https://github.com/rbenv/rbenv) or [asdf](https://asdf-vm.com/))
- Node.js 22+ and Yarn
- PostgreSQL 16

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/resilience.git
cd resilience

# 2. Backend setup
cd backend
bundle install
cp .env.example .env
# Edit .env — fill in SECRET_KEY_BASE (run: bin/rails secret)
bin/rails db:create db:migrate db:seed

# 3. Start the backend (in one terminal)
RAILS_MAX_THREADS=48 bundle exec rails server

# 4. Frontend setup (in another terminal)
cd ../frontend
yarn install
yarn dev
```

Open **[http://localhost:5176](http://localhost:5176)**

**Running the test suite**
```bash
cd backend
bundle exec rspec                         # 653 examples, ~8s
bundle exec brakeman --no-progress -q     # security scan
bundle exec bundler-audit check           # CVE check

cd ../frontend
yarn tsc --noEmit                         # type check
yarn lint                                 # ESLint
yarn build                                # production build
```

---

## Key Engineering Decisions

These are the non-obvious design choices worth knowing about if you're reading the code.

**Audit log written in the same transaction**
Every mutation (update a site, transition a task, assign an incident) writes an `AuditEvent` record with `before_snapshot` and `after_snapshot` inside the same database transaction. The audit log is structurally impossible to diverge from the data — if the write fails, the audit event doesn't exist either.

**Atomic rule cooldown enforcement**
Rule cooldowns are claimed with a single `UPDATE ... WHERE (last_fired_at IS NULL OR last_fired_at <= ?)`. If `rows_updated = 0`, the cooldown is still active and the job returns silently. Two concurrent workers can never double-fire the same rule because only one UPDATE can win.

**Compound rules with zero data migration**
When compound (AND/OR multi-signal) rule support was added, existing flat rules were not migrated. Instead, they're coerced to compound format at read time via `normalized_conditions`. The type discriminator is the presence of an `operator` key — flat rules just don't have one.

**Short-lived SSE tokens**
The browser's `EventSource` API can't send custom headers, so the JWT would normally have to go in the URL query string where it's visible in proxy logs and browser history. Instead, the frontend posts to `/api/sse_token` immediately before opening the stream, gets a 60-second SSE-only token, and uses that in the URL. The 24h JWT never appears in a URL.

**AI trust boundary on recommendations**
The `Recommendations::Validator` runs four checks on every LLM-produced recommendation before it's saved: (1) the surfaced entity exists, (2) each evidence item exists, (3) the action payload IDs exist, (4) the payload IDs refer to the **same entity** as the surfaced entity. This last check is the important one — without it, an LLM could display "Incident A" in the UI but carry "Incident B" in the executable payload, and both would pass existence checks.

**Virtual list for the signal feed**
The signal feed uses `@tanstack/react-virtual`. Regardless of how many signals are in the database, only ~25 DOM nodes are rendered at any scroll position. `useInfiniteQuery` fetches the next page of 75 rows when the last virtual item scrolls within 10 rows of the bottom.

---

## Live Signal Feeds

4 out of 7 signal types work without any credentials. The other 3 require free account registration.

| Signal type | Source | Credentials |
|-------------|--------|------------|
| Seismic events | USGS Earthquake Hazards | None — always live |
| Aircraft positions | OpenSky Network | None — anonymous mode (300s startup delay) |
| Disaster alerts | GDACS | None — always live |
| GPS jamming | GPSJam.org | None — always live |
| Wildfire detections | NASA FIRMS | Free key — [EarthData](https://firms.modaps.eosdis.nasa.gov/api/map_key/) |
| Vessel positions | AISHub | Free account — [AISHub](https://www.aishub.net/join-us) |
| Conflict events | ACLED | Free account — [ACLED](https://developer.acleddata.com/) |

All 7 signal types appear immediately on first run via seeded demo data regardless of credentials.

To add credentials when using Docker:
```bash
NASA_FIRMS_MAP_KEY=your-key AISHUB_USERNAME=your-user docker compose up
```

To add credentials for local development, add them to `backend/.env` (see `.env.example`).

---

## Project Structure

```
resilience/
├── compose.yml              # Docker Compose — runs the full app with one command
├── Dockerfile               # Multi-stage: builds frontend → embeds in Rails → production image
├── frontend/                # React 19 + TypeScript + Vite
│   └── src/
│       ├── api/             # API client functions (one file per resource)
│       ├── components/      # Shared UI components
│       ├── context/         # AuthContext, ReplayContext
│       ├── hooks/           # React Query hooks (one file per resource)
│       ├── pages/           # Page components (one per route)
│       └── lib/             # Utilities (signal icons, toaster)
└── backend/                 # Rails 8 API
    ├── app/
    │   ├── controllers/api/ # API controllers (thin — delegate to services)
    │   ├── models/          # ActiveRecord models + validations + scopes
    │   ├── services/        # Business logic (one class per operation)
    │   └── jobs/            # SolidQueue background jobs
    ├── db/
    │   ├── migrate/         # Database migrations
    │   ├── structure.sql    # Committed schema (not schema.rb)
    │   └── seeds.rb         # Demo data
    └── spec/                # RSpec tests (653 examples)
```

---

## License

MIT
