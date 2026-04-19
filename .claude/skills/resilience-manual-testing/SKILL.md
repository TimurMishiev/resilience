---
name: resilience-manual-testing
description: >
  Canonical browser QA skill for Resilience, with slice-targeted, regression, and
  full-functional modes.
when_to_use: >
  Use for manual testing, browser QA, functional testing, regression testing,
  full front-end sweeps, end-to-end product verification, map/globe verification,
  AI verification, replay verification, or requests to exercise the app like a high-bar QA engineer.
---

# Resilience Manual Testing

This is the repo-specific browser QA skill for Resilience.

Use it to test the actual product in a browser:
- route by route
- role by role
- replay-aware where relevant
- with special attention to AI, Map, Globe, and other operator-critical surfaces

This skill complements:
- `resilience-execution` for building slices
- `gate` for pre-commit review
- `audit` for whole-system forensic review
- `webapp-testing` as the generic Playwright toolkit underneath

For Resilience, prefer this skill over generic `webapp-testing`.

This is the canonical project-specific browser QA skill.
Do not create a second project skill for "functional testing" or "regression testing."
Those are modes inside this skill.

## Core standard

Act like a high-bar QA lead on a high-stakes operational product.

The goal is not to click around casually. The goal is to verify that the app behaves correctly in the browser and to report only real, observed failures.

Report:
- confirmed browser-visible failures
- confirmed console/runtime errors
- confirmed failed network requests that break user behavior
- confirmed role-boundary failures visible from the UI/API behavior
- confirmed replay/map/globe/AI behavior mismatches

Do not report:
- speculative concerns
- code smells
- “probably broken” guesses
- untested areas as if they were defects

If something was not exercised, say so plainly under `Not Exercised`.

## Testing modes

### 1. Slice-targeted verification

Use after a slice or before a commit when the user wants browser confirmation for the changed surface.

Focus on:
- touched routes
- adjacent workflows
- role gating
- replay/trust integrity if relevant
- map/globe/AI regressions if relevant

### 2. Regression sweep

Use after meaningful product work when the user wants confidence that newly built slices did not
break previously shipped behavior.

This is the default broad QA mode for normal development.

Minimum regression floor:
- login and shell navigation
- dashboard
- alerts / incidents / tasks / sites / assets core routes
- map
- globe
- replay entry and replay-safe copy on map/globe
- role boundaries for commander / operator / viewer
- AI surfaces (`/briefing`, `/ontology`) with real-key or graceful-degradation verification

Always reuse the existing Playwright suite first for this mode, then manually verify the
highest-risk product surfaces directly in the browser.

Use the regression checklist in:
- `references/regression-sweep.md`

### 3. Full functional sweep

Use when the user asks for a serious browser pass across the whole app.

This means:
- commander / operator / viewer passes where meaningful
- route-by-route coverage
- special handling for AI, Map, Globe, replay, and role boundaries
- artifacts for any confirmed failure

This is the exhaustive browser pass, not the default every-slice check.

Use the route matrix in:
- `references/test-matrix.md`

## Environment model

### Interactive browser stack

For broad manual testing, prefer the local Docker app described in the repo:

```bash
cd /Users/timurmishiev/Desktop/Code/resilience
docker compose up
```

Open:
- `http://localhost:3000`

Seeded demo accounts:
- commander: `commander@resilience.mil` / `password123`
- operator: `operator@resilience.mil` / `password123`
- viewer: `viewer@resilience.mil` / `password123`

There is **no default seeded admin account** in the normal local seed path.
If an admin surface must be tested, either:
- use a locally provisioned admin account if one exists
- or report that admin-only surfaces were not exercised

### Playwright-assisted verification

Resilience already has a real E2E harness under:
- `/Users/timurmishiev/Desktop/Code/resilience/frontend/e2e`

Prefer that harness over inventing ad-hoc browser automation.

Important repo facts:
- Playwright base URL defaults to `http://127.0.0.1:4178`
- frontend dev/preview proxies `/api/*` to `http://localhost:3000`
- auth fixtures already exist for commander/operator/viewer in `frontend/e2e/.auth`
- helpers already implement login, role login, failed-request capture, and E2E bridge wiring

Key files:
- `/Users/timurmishiev/Desktop/Code/resilience/frontend/playwright.config.ts`
- `/Users/timurmishiev/Desktop/Code/resilience/frontend/e2e/global.setup.ts`
- `/Users/timurmishiev/Desktop/Code/resilience/frontend/e2e/helpers.ts`

If you need a browser-driven regression pass:
- use the existing Playwright suite first
- then do direct browser verification on the highest-risk flows or the user-requested flows

## AI prerequisite

AI feature verification is environment-sensitive.

Per repo docs, live AI features require `ANTHROPIC_API_KEY`.

That means:
- if the key is present, verify real AI behavior
- if the key is absent, verify the UI fails or degrades honestly

Do **not** report “AI broken” if the environment simply lacks the required API key.
Instead report:
- `AI not functionally exercised because ANTHROPIC_API_KEY was absent`
- or `AI surface did not degrade honestly when the key was absent`

For Resilience, treat these as the primary AI surfaces:
- `/briefing`
- `/ontology`

Recommendations are operationally important, but seeded recommendation rows are not proof of live AI generation by themselves.

## Map / Globe priority

Map and Globe are mandatory high-attention surfaces in this repo.

Always pay close attention to:
- WebGL/Cesium/MapLibre initialization errors
- blank canvases or partial render
- selection sync
- route sync when the surface encodes selection in URL/query state
- side-panel handoffs
- replay correctness
- evidence highlighting
- trust/freshness rendering
- failed tile/data requests
- browser console errors

Do not mark Map or Globe healthy just because the page mounted.

## Replay / trust priority

When a surface supports replay or time-travel:
- verify the page uses replay time rather than wall-clock assumptions
- verify relative times make sense in replay
- verify replay does not leak live state
- verify mutation affordances stay blocked if the surface is replay-safe/read-only

When a surface exposes freshness/trust:
- preserve the distinction between healthy / aging / stale / unavailable
- do not treat “no data” and “stale data” as the same state

## Role-boundary priority

At minimum, use:
- commander
- operator
- viewer

Check:
- login works
- route access is appropriate
- action affordances appear only where expected
- protected actions fail honestly if not allowed

Only test admin-only routes if a real admin account exists locally.

## Working method

### Step 1: Read the scope and choose the mode

First determine whether the user wants:
- a slice-targeted verification
- a regression sweep
- a full functional sweep
- a map/globe/AI-focused pass

If the request is broad:
- regression confidence across shipped work -> use `Regression sweep`
- exhaustive full front-end/browser verification -> use `Full functional sweep`

### Step 2: Preflight the environment

Check:
- app reachable
- correct base URL
- seeded login works
- browser can initialize the page without immediate fatal errors

For any environment blocker, state it clearly and stop rather than pretending the product failed.

### Step 3: Use existing E2E coverage as accelerator, not as the whole test

When appropriate, run the relevant existing Playwright specs first.

Then still do direct browser verification on:
- the user-requested flow
- high-risk adjacent flows
- AI / Map / Globe / replay surfaces if they are in scope

Do not hide behind a green automated run if the browser still needs direct verification.

### Step 4: Exercise the right checklist

For `Regression sweep`, use:
- `references/regression-sweep.md`

For `Full functional sweep`, use:
- `references/test-matrix.md`

For each exercised surface, verify:
- page loads
- critical controls render
- core actions work
- role gating is correct
- no critical console/runtime/network errors
- navigation and detail handoffs work
- replay/trust behavior is correct if relevant

### Step 5: Capture evidence for failures

For any confirmed defect, collect as available:
- screenshot
- console error text
- failed request details
- route/role used
- clear reproduction steps

### Step 6: Report only observed failures

Keep the final report grounded in what the browser actually showed.

Separate:
- `Confirmed Findings`
- `Not Exercised`
- `Environment Limitations`

## Existing E2E accelerators

Use the repo’s existing specs where they match the request, especially:
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

These are accelerators, not substitutes for browser judgment.

## Output format

Return results in this structure:

## 1. Test Scope
- full product sweep / targeted regression / focused browser pass
- environment used
- roles used

## 2. What Was Exercised
- pages and workflows tested
- whether AI was truly exercised or only graceful degradation was verified
- whether Map and Globe were exercised directly

## 3. Confirmed Findings
- only directly observed issues
- include route, role, repro, and artifact summary

## 4. Environment Limitations
- missing API keys
- unavailable admin account
- local server issues
- anything that prevented real execution

## 5. Not Exercised
- routes or roles that were intentionally skipped or blocked by environment

## 6. Overall QA Verdict
- pass / pass with issues / blocked
- short explanation

## Final rules

- Prefer the repo’s existing Playwright harness before inventing new automation
- Prefer direct browser evidence over assumption
- Map, Globe, Replay, and AI get extra scrutiny
- Admin-only surfaces are not failures if the local environment lacks an admin user
- Missing `ANTHROPIC_API_KEY` is not an AI bug; dishonest degradation is
- Untested is not broken
- Suspected is not confirmed
