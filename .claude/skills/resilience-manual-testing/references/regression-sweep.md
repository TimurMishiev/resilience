# Resilience Regression Sweep

Use this checklist for the normal high-confidence regression pass after meaningful shipped work.

The goal is not to cover every edge route. The goal is to prove that previously built product
surfaces still work after the latest tranche.

## Minimum role coverage

- commander
- operator
- viewer

## Minimum regression floor

### 1. Login + shell
- commander can sign in
- operator can sign in
- viewer can sign in
- invalid login fails honestly
- top-level navigation does not break the shell

### 2. Core operational routes
- `/dashboard`
- `/alerts`
- `/incidents`
- `/tasks`
- `/sites`
- `/assets`

For each:
- route loads
- primary data surface renders
- no critical console/runtime error
- no failed request that breaks the route

### 3. High-risk spatial surfaces
- `/map`
- `/globe`

For each:
- surface initializes cleanly
- no blank canvas / fatal render failure
- core selection works
- panel/detail handoff works
- no critical console/runtime error

### 4. Replay regression floor
- enter replay
- verify replay banner / status is honest
- verify replay-safe copy is correct on map/globe if exercised
- verify replay does not expose live-only mutation affordances on replay-safe surfaces

### 5. AI regression floor
- `/briefing`
- `/ontology`

If `ANTHROPIC_API_KEY` exists:
- verify a real request/response cycle works
- verify the response is grounded enough to count as functional

If `ANTHROPIC_API_KEY` is absent:
- verify the surface fails or degrades honestly

### 6. Role-boundary regression floor

Commander:
- allowed commander-only routes/actions remain available

Operator:
- commander-only routes/actions remain blocked
- normal operator routes/actions still work

Viewer:
- read-only routes work
- protected mutations remain blocked

## Strong accelerators

Run the relevant existing Playwright specs first, especially:
- `critical-paths.spec.ts`
- `role-boundaries.spec.ts`
- `ops-smoke.spec.ts`
- `replay-map.spec.ts`
- `replay-globe.spec.ts`
- `map-globe-selection.spec.ts`
- `signals-page.spec.ts`

Then still manually verify the highest-risk paths directly in the browser.

## Reporting

Separate results into:
- `Confirmed Findings`
- `Not Exercised`
- `Environment Limitations`

Do not claim "full functional coverage" from this mode. This is the regression floor, not the exhaustive sweep.
