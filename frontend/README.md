# Resilience — Frontend

React 19 + TypeScript + Vite frontend for the Resilience operational intelligence platform.

This directory holds the frontend. For project overview, architecture, UI stack, operational surfaces, and full setup instructions see:

- [`../README.md`](../README.md) — project overview, operational surfaces (map, globe, incidents, planning, AI briefing, replay), tech stack, CI pipeline
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — local dev setup, test commands, code conventions
- [`../CLAUDE.md`](../CLAUDE.md) — repo entrypoint for AI agents

## Quick reference

- Dev server: `yarn dev` (proxies `/api/*` to Rails on port 3000)
- Type check: `npx tsc --noEmit`
- Lint: `yarn lint`
- Run unit + integration tests: `npx vitest run`
- Run E2E: `npx playwright test`
- Production build: `yarn build` (`tsc -b` is stricter than `tsc --noEmit`)

## Layout

- `src/pages/` — 26 page components (dashboard, map, globe, incidents, planning, replay, etc.)
- `src/components/` — 80 shared components (map/, dashboard/, shell/, blueprint wrappers)
- `src/hooks/` — 64 hooks (data fetching, engine bridges, telemetry, replay)
- `src/api/` — 24 API client modules
- `src/context/` — `AuthContext`, `ReplayContext`, `ClassificationContext`
- `src/test/` — 105 Vitest test files
- `e2e/` — 15 Playwright spec files (55 tests)
