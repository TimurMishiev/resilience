---
name: project_open_findings
description: Open engineering debt and architecture programs
type: findings
---

# Resilience — Open Findings

## P1 / High-Leverage Programs

- Replay parity is still incomplete on:
  - `frontend/src/pages/RecommendationsPage.tsx`
  - `frontend/src/components/OntologyQueryPanel.tsx`
  - `frontend/src/pages/IncidentDetailPage.tsx`
  - `frontend/src/pages/AlertTriagePage.tsx`
- Tenant/workspace isolation is still missing.
  - Core domain data is still effectively single-tenant.

## P2 / Important Platform Follow-Through

- Security/identity maturity is still incomplete even after scoped auth enforcement shipped.
  - The platform now supports `viewer`, `operator`, and `commander` plus org/AO scoping.
  - Remaining work is broader role modeling, device/session inventory, and admin/global revocation controls.
- Session security maturity is not finished after logout revocation.
  - “Sign out all devices” and broader session lifecycle controls still do not exist.
- The remaining SSE architecture ceiling is still thread-per-connection transport.
  - Admission control is hardened, but the transport model itself is unchanged.
- Frontend maintenance concentration remains high in:
  - `frontend/src/hooks/useGlobeEngine.ts`
  - `frontend/src/hooks/useMapLibreEngine.ts`
  - `frontend/src/pages/PlanningPage.tsx`
  - `frontend/src/pages/CorrelationRulesPage.tsx`
  - `frontend/src/pages/GlobePage.tsx`

## P3 / Ongoing Hygiene

- Keep `backend/db/structure.sql` and the local test environment aligned with the supported PostGIS baseline.
- Keep `memory/project_resilience.md`, this roadmap file, and actual code aligned.
- Avoid reintroducing local-only docs like `CLAUDE.md` into shared commits.
