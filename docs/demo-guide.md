# Resilience Demo Guide

This guide is for a reviewer who wants to understand the product quickly without reverse-engineering the UI.

## Credentials

| Role | Email | Password | Best use |
|------|-------|----------|----------|
| Commander | `commander@resilience.mil` | `password123` | Full walkthrough, planning, AI, health |
| Operator | `operator@resilience.mil` | `password123` | Operational workflow without commander-only surfaces |
| Viewer | `viewer@resilience.mil` | `password123` | Read-only access and role-boundary checks |

## Fastest Production Walkthrough

Use the live app at [https://resilience-ops.fly.dev](https://resilience-ops.fly.dev) with the commander account.

1. `Dashboard`
   - Confirm the KPI row, site readiness bars, recent alerts, and recommendation panel render.
2. `Map`
   - Click a site marker.
   - Open the inspector.
   - Toggle replay and confirm the `REPLAY` banner and read-only behavior.
3. `Globe`
   - Navigate from the sidebar, not a full-page reload.
   - Click a site and confirm the same selection/inspector pattern exists in 3D.
   - Toggle replay and confirm replay-safe wording appears here too.
4. `Incidents`
   - Open any incident.
   - Walk `Evidence`, `Tasks`, `Recommendations`, `Notes`, and `History`.
   - `History` is the audit surface.
5. `Signals` or `Alerts`
   - Confirm live operational data is present and the dense table/inbox surfaces load without route errors.
6. `Security`
   - Open the sessions page as commander to confirm the admin/security boundary exists.
7. `Planning`
   - Confirm commander-only doctrine surfaces are available.

## Role-Boundary Quick Check

Use the `viewer` account and verify:

1. `Dashboard`, `Sites`, `Tasks`, and `Incidents` are readable.
2. `Planning`, `Briefing`, and `Ontology` show locked or access-restricted states.
3. `Health` shows the commander-only lockout view.

Use the `operator` account and verify:

1. operational read surfaces are accessible
2. commander-only planning and AI surfaces remain locked

## AI Surfaces

- `Briefing` and `Ontology` require live Anthropic availability.
- If the app returns `AI service is unavailable. Contact your administrator.`, the product is degrading honestly.
- For local evaluation, run with `ANTHROPIC_API_KEY=...`.

## Local Docker Run

```bash
git clone https://github.com/TimurMishiev/resilience.git
cd resilience
docker compose up
```

Open [http://localhost:3000](http://localhost:3000).

To enable AI locally:

```bash
ANTHROPIC_API_KEY=sk-ant-... docker compose up
```

## What To Look For

- Map and globe both render and keep selection state coherent.
- Replay clearly changes state and disables live-only affordances.
- Incidents and site detail pages show evidence and history, not just pretty cards.
- Role boundaries are enforced server-side, not just hidden in the sidebar.
- AI is treated as optional capability, not as a trusted source of truth.
