# Resilience — Mission Operations Console

A React + TypeScript operational console for managing distributed field tasks across sites, featuring controlled workflows, immutable audit logs, deterministic time-based replay, geospatial visualization, and grounded AI-powered operational summaries.

## Repository structure

```
/backend      Rails 8 API-only application (PostgreSQL)
/frontend     React + TypeScript operator UI (Phase 3)
/contracts    OpenAPI 3.1 specifications
/docs         Architecture Decision Records and design docs
```

## Stack

| Layer    | Technology                                  |
|----------|---------------------------------------------|
| Backend  | Ruby on Rails 8, PostgreSQL 16              |
| Frontend | React, TypeScript (strict), Blueprint.js    |
| Testing  | RSpec, FactoryBot, Playwright               |
| Map      | MapLibre GL (Phase 5)                       |
| AI       | Claude API via Rails proxy (Phase 6)        |

## Phases

- [x] Phase 0 — Product definition, architecture, scope freeze
- [ ] Phase 1 — Schema, models, service layer, RSpec, OpenAPI contract
- [ ] Phase 2 — REST endpoints, transition endpoint, audit timeline, replay
- [ ] Phase 3 — Frontend scaffold, Blueprint layout, typed API client
- [ ] Phase 4 — Audit timeline UI, replay time selector
- [ ] Phase 5 — Map integration, geospatial filtering
- [ ] Phase 6 — AI endpoints, citation validation, summaries
- [ ] Phase 7 — Tests, performance pass, docs, demo

## Development setup

See `/backend/README.md` for backend setup instructions.
