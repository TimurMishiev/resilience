# Resilience Full Functional QA Matrix

Use this matrix for the exhaustive browser pass across the full front end.

This is not the normal regression floor.
For broad post-slice regression confidence, use:
- `references/regression-sweep.md`

## Roles

Default seeded roles:
- commander
- operator
- viewer

Admin:
- not seeded by default in the normal local demo environment
- only test admin-only routes if a real admin account exists locally

## Environment reminders

- interactive Docker app: `http://localhost:3000`
- Playwright preview base URL: `http://127.0.0.1:4178`
- frontend preview proxies `/api/*` to `http://localhost:3000`
- live AI verification requires `ANTHROPIC_API_KEY`

## Existing Playwright coverage to reuse first

- `ops-smoke.spec.ts`
- `critical-paths.spec.ts`
- `role-boundaries.spec.ts`
- `signals-page.spec.ts`
- `planning-doctrine.spec.ts`
- `map-site-selection.spec.ts`
- `map-globe-selection.spec.ts`
- `replay-map.spec.ts`
- `replay-globe.spec.ts`
- `globe-site-anchor.spec.ts`
- `globe-overlay-clickthrough.spec.ts`
- `live-map-streams.spec.ts`
- `globe-benchmark.spec.ts`

Run the relevant specs first when they match the target surface, then do direct browser verification.

## Full route matrix

### `/login`
- verify login succeeds for commander/operator/viewer
- verify invalid credentials fail honestly
- verify no immediate console/runtime errors

### Shell / navigation
- verify top-level navigation loads without broken routes
- verify route changes do not leave the shell in a broken state
- verify logout works if in scope

### `/dashboard`
- verify core dashboard widgets render without errors
- verify summary cards and major panels load
- verify navigation from dashboard into deeper surfaces works where offered

### `/sites`
- verify list/table renders
- verify site selection or row navigation works
- verify replay-aware indicators are honest if visible

### `/sites/:id`
- verify detail surface renders without broken sections
- verify timeline/history/risk/supporting context loads
- verify related navigation out of site detail works

### `/tasks`
- verify task list renders
- verify commander/operator/viewer affordances match role
- verify workflow actions work or are correctly hidden/disabled

### `/assets`
- verify asset list renders
- verify freshness/trust cues are visible and coherent
- verify detail drawer or selection flow works

### `/map`
- verify map initializes successfully
- verify no blank canvas / fatal console error / failed critical request
- verify entity selection works
- verify panel handoffs work
- verify replay behavior if in scope
- verify evidence highlighting / trust rendering if in scope

### `/graph`
- verify graph renders
- verify interactions do not break the page
- verify selected-node or linked-entity behavior works if present

### `/globe`
- verify globe initializes successfully
- verify no Cesium fatal errors or blank globe
- verify site/signal selection works
- verify overlays and clickthroughs work
- verify replay behavior if in scope

### `/briefing`
- commander should reach the page
- operator/viewer should respect role boundaries
- if `ANTHROPIC_API_KEY` exists, verify real AI response flow
- if key absent, verify graceful honest degradation

### `/ontology`
- commander should reach the page
- operator/viewer should respect role boundaries
- if `ANTHROPIC_API_KEY` exists, verify real AI query/response behavior
- if key absent, verify graceful honest degradation

### `/incidents`
- verify incident list renders
- verify incident detail navigation works
- verify role affordances are correct

### `/incidents/:id`
- verify workspace loads fully
- verify notes/history/prosecution or equivalent panels render
- verify mutations respect role boundaries

### `/recommendations`
- verify list renders
- verify evidence/context drawers or panels open cleanly
- verify operator-visible lifecycle actions behave honestly
- do not treat seeded rows as proof of live AI generation

### `/security`
- verify current sessions render
- verify revoke controls behave honestly for available roles
- admin-targeted cross-user checks only if a real admin account exists

### `/alerts`
- verify triage list renders
- verify workflow transitions work for allowed roles
- verify viewer cannot mutate

### `/signals`
- verify signal feed loads
- verify filters/search/sorting if present
- verify live/update-oriented UI does not error

### `/rules`
- commander should have appropriate mutation affordances
- operator/viewer should respect role boundaries
- verify list/detail/drawer flows do not break

### `/areas`
- verify AO surface renders
- verify doctrine/overlay/supporting context loads without obvious errors

### `/planning`
- commander-focused surface
- verify doctrine/intents/PACE-related flows render and save honestly if in scope
- verify non-commander behavior respects role boundaries

### `/swimlane`
- verify swimlane/timeline style view renders
- verify cards/rows/interactions do not break

### `/health`
- verify operational-health cards and tables render
- verify stale/unavailable language is coherent if surfaced

### `/organizations`
- admin-only in practice
- only exercise if a real admin account exists locally

### `/users`
- admin-only in practice
- only exercise if a real admin account exists locally
- if exercised, verify role edit / org edit / AO assignment flows behave honestly

## Mandatory high-risk passes

For any broad QA pass, give extra attention to:
- AI surfaces: `/briefing`, `/ontology`
- spatial surfaces: `/map`, `/globe`
- replay-aware flows
- role boundaries

## Findings standard

A browser finding is real only if at least one of these is true:
- the defect is directly visible in the UI
- the workflow fails in reproduction
- a console/runtime error clearly breaks the surface
- a failed request clearly breaks the user path

If none of those happened, do not file it as a confirmed finding.
