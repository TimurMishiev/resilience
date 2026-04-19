---
name: execution_handoff
description: Active handoff file for the current phase, slice, validation, and takeover safety
type: project
---

# Resilience — Execution Handoff

Last updated: 2026-04-19

## Current Phase

Phase 5 — Evidence Threading

(Phase 4 — Debrief closed. Phase 5 Slice 1 shipped as `e1632fc`. No product-code slice is currently active. If `git status` is dirty right now, it should only be this handoff update until it is committed.)

## Current Slice

No active slice. Phase 5 Slice 1 shipped as `e1632fc`. Awaiting user direction on Phase 5 Slice 2.

## Current Repo State

- `HEAD`: `1df87b2` — `Update handoff after Phase 5 Slice 1 ship` (handoff-refresh commit on top of Slice 1 ship `e1632fc`)
- No active product-code tranche is in progress
- If the working tree is dirty, treat this handoff file itself as the only expected maintenance change unless `git status` proves otherwise
- A takeover model should confirm Phase 5 Slice 2 direction with the user before writing code

## Phase 5 Slice 2 — Direction To Confirm

Phase 5's goal in `execution_context.md` is to make operational conclusions explainable and traceable. Slice 1 delivered the first threading point (incident → alert → `AlertChainDrawer`). The next slice should be one of these concrete options, decided with the user rather than picked autonomously:

- **5-2A — recommendation evidence access:** add a "Show evidence" affordance on `/briefing` (or the ontology recommendations surface) that surfaces the signals/alerts/rules backing the recommendation. Prerequisite: confirm the recommendation payload already carries the right provenance IDs, or define the minimum contract extension.
- **5-2B — map/globe alert evidence context:** wire `AlertChainDrawer` into alert selection on `/map` or `/globe` so the same drawer is one click from a spatial alert marker. Prerequisite: confirm map/globe selection panels already resolve alerts to `SignalRuleMatch` shape.
- **5-2C — stale-basis surfacing:** annotate the drawer (or its callers) with a stale-evidence indicator when the backing signal/rule/site has aged past its freshness window, reusing the existing trust/freshness model. Prerequisite: confirm where staleness is computed today and whether the drawer already has the inputs.

**Do not jump to a generalized `EvidenceContext` / `useEvidenceSource` abstraction.** `AlertChainDrawer` currently has four real UI consumers: `AlertTriagePage`, `SiteDetailPage`, `AlertsPanel` on `DashboardPage`, and `IncidentAlertsTab`. It still fits as a prop-driven component. Wait for a fifth distinct evidence surface before formalizing a shared evidence interface.

## Shipped In This Phase

- `e1632fc` — Phase 5 Slice 1: incident alert evidence access
  - backend: detailed `/api/incidents/:id` alert rows now carry `site`, `task`, `acknowledged_by`, `notes`, `metadata`; replay path routes task/site snapshots through `serialize_alert`; new `serialize_alert_site` / `serialize_alert_task` helpers mirror the existing rule/site snapshot patterns; task visibility follows the `task_visible` rule (hides tasks created after `as_of`)
  - frontend: `IncidentAlert` collapsed onto `SignalRuleMatch & { geofence_breach: boolean }`; `IncidentAlertsTab` adds a row-level "Show evidence" button wired to `AlertChainDrawer`
  - tests: one happy-path spec on the detailed response (metadata, site, task, ack_by, notes); existing replay spec extended to assert `acknowledged_at` / `acknowledged_by` / `notes` are all nil when the ack happened after `as_of` (closes the P3 from `/gate`); new `IncidentAlertsTab.test.tsx` covers empty-state + drawer-open

## Shipped In Prior Phases (Phase 4 context)

- `2c49a3c` — Phase 4 Slice 1: debrief audit-events API prerequisites
- `afd68b7` — Phase 4 Slice 2: commander-only debrief timeline page
- `45906cb`, `d202532`, `67caf3b`, `70b3de4` — Phase 4 Slice 3: click-to-reconstruct + hardening
- `8ebedf9` — Phase 4 Slices 4a + 4b: temporal diff surfaces + incident A/B compare
- `eec8439` — Phase 4 Slice 4c: site A/B compare
- `7ba0155` — Phase 4 Slice 4c-followup: compare-tab hardening

## In Progress

- No active implementation slice.
- Phase 5 Slice 1 is shipped.
- If the repo is currently dirty, that should only be this handoff update until it is persisted.

## Next

- **Awaiting user direction** between 5-2A / 5-2B / 5-2C above. Do not start a Phase 5 Slice 2 tranche without explicit selection — each option has different blast radius and different prerequisite verification work.
- If direction is unclear after user input, re-read `execution_context.md` Phase 5 validation checklist and ask which unchecked item feels most operationally useful next.

## Files Changed This Slice

- No active working-tree implementation slice.
- The most recently shipped slice (`e1632fc`) changed:
  - `backend/app/controllers/api/incidents_controller.rb`
  - `backend/app/controllers/concerns/incident_serialization.rb`
  - `backend/spec/requests/api/incidents_spec.rb`
  - `frontend/src/api/incidents.ts`
  - `frontend/src/components/incident-detail/IncidentAlertsTab.tsx`
  - `frontend/src/test/IncidentAlertsTab.test.tsx`

## Currently Locked Files

- none

## Validation Commands

```bash
cd /Users/timurmishiev/Desktop/Code/resilience/backend && TEST_DATABASE_PORT=5434 /Users/timurmishiev/.rbenv/shims/bundle exec rspec spec/requests/api/incidents_spec.rb
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run src/test/IncidentAlertsTab.test.tsx src/test/IncidentDetailPage.test.tsx
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx tsc -p tsconfig.app.json --noEmit
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx eslint src/components/incident-detail/IncidentAlertsTab.tsx src/test/IncidentAlertsTab.test.tsx src/api/incidents.ts
git -C /Users/timurmishiev/Desktop/Code/resilience diff --check
```

## Last Validation Results (Phase 5 Slice 1 pre-commit, 2026-04-19)

These numbers are from the validation run that gated `e1632fc`. They are not a re-run against the handoff-refresh commit `1df87b2`; the post-push hook re-ran the full gate suite on `1df87b2` (Brakeman / bundler-audit / RSpec / vitest / tsc / ESLint / vite build) and all reported clean.

- Backend focused request spec: **51 examples, 0 failures**
- Frontend focused tests: **11/11 pass**
- Full Vitest suite: **557 tests across 78 files, 0 failures**
- TypeScript (`tsconfig.app.json`): **0 errors**
- ESLint on touched frontend files: **0 errors, 0 warnings**
- `git diff --check`: **clean**

## Known Risks / Blockers

- Backend local validation still needs the repo Ruby path:
  - `TEST_DATABASE_PORT=5434 /Users/timurmishiev/.rbenv/shims/bundle exec ...`
  - the system `bundle` path still fails on the known Bundler `2.7.2` mismatch
- Frontend type-check must continue using:
  - `npx tsc -p tsconfig.app.json --noEmit`
  - the loose root `tsc --noEmit` is not authoritative for this repo
- Incident alert evidence enrichment is intentionally scoped to the incident show payload only. It does **not** widen list/infinite alert APIs.
- `IncidentAlertsTab` now reuses `AlertChainDrawer`, but this is still a static evidence/provenance view. If a future slice needs deep-link navigation or stale-basis warnings inside that drawer, do it explicitly.
- Replay intentionally keeps nested alert `task` nil when the linked task did not yet exist at `as_of`. Do not “helpfully” fill it from live state.

## Do Not Reopen

- Phase 0 — Execution Foundation
- Phase 1 — Trustworthy Operational Picture
- Phase 2 — Map workstation + triage-in-context
- Phase 3 — Spatial analytics + spatial trust rendering
- Phase 4 Slice 1 — debrief audit-events API prerequisites
- Phase 4 Slice 2 — debrief entry + meaningful-event timeline
- Phase 4 Slice 3 — click-to-reconstruct workflow
- Phase 4 Slices 4a + 4b — temporal diff + incident compare
- Phase 4 Slice 4c — site compare
- Phase 4 Slice 4c-followup — compare-tab hardening
- project-skill consolidation / deep-review removal / repo-managed `.claude/skills`
