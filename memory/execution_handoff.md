---
name: execution_handoff
description: Active handoff file for the current phase, slice, validation, and takeover safety
type: project
---

# Resilience — Execution Handoff

Last updated: 2026-04-15

## Current Phase

Phase 2 — Map Workstation + Triage-in-Context

## Current Slice

Support cleanup — align `created_by_id` payload naming across AO/correlation-rule replay serializers, TypeScript domain types, and fixtures so the repo stays contract-consistent before Phase 2 resumes — IN PROGRESS

## Objective

Keep the shared API contract coherent: replay serializers for areas of operation and correlation rules should expose `created_by_id`, matching the rest of the backend serializers and frontend types.

## Why This Slice

This is a small out-of-band consistency cleanup. It does not advance the active `/map` workstation program directly, but it removes a naming mismatch before more Phase 2 work piles on top of stale fixtures and serializer drift.

## Completed This Session

- areas of operation replay serialization now emits `created_by_id`, and the AO request spec expects that field explicitly
- correlation rule replay serialization now emits `created_by_id`, and frontend fixtures/types for rules and AO consumers were aligned
- direct request-level proof for correlation-rule responses now pins `created_by_id` and rejects the old `created_by` response key
- unrelated untracked incident request specs were verified green but intentionally left out of this cleanup tranche

## In Progress

- final hygiene on the contract cleanup tranche, then return to the active Phase 2 `/map` slices

## Next

- Phase 2 Slice 4 — extend triage-in-context to asset/signal selections. This likely needs new backend scopes (`for_asset`, or a signal-level join) since `SignalRuleMatch` has no `asset_id` column today — scope the backend work at the start of that slice
- Phase 2 Slice 5 — cross-panel coordination: selecting a site from the triage panel flies the map to it and vice-versa

## Files Likely To Change

- `/Users/timurmishiev/Desktop/Code/resilience/memory/execution_context.md`
- `/Users/timurmishiev/Desktop/Code/resilience/memory/execution_handoff.md`
- `/Users/timurmishiev/Desktop/Code/resilience/frontend/src/pages/MapPage.tsx`
- Phase 2 `/map` workstation surfaces — to be scoped at the start of that slice

## Currently Locked Files

- `/Users/timurmishiev/Desktop/Code/resilience/backend/spec/requests/api/incidents/notes_spec.rb`
- `/Users/timurmishiev/Desktop/Code/resilience/backend/spec/requests/api/incidents/prosecution_spec.rb`
  These untracked specs are green but unrelated to the current contract-cleanup tranche. Keep them out of the next commit unless they are deliberately promoted into their own slice.

## Validation Commands

```bash
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx tsc --noEmit
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx eslint src
cd /Users/timurmishiev/Desktop/Code/resilience && git diff --check
```

## Last Validation Results

Contract-cleanup validation run:

- Focused backend: `spec/requests/api/areas_of_operation_spec.rb`, `spec/requests/api/correlation_rules_spec.rb` → 69 examples, 0 failures
- Focused unrelated residue check: `spec/requests/api/incidents/notes_spec.rb`, `spec/requests/api/incidents/prosecution_spec.rb` → 32 examples, 0 failures
- Vitest: full suite — 68 files, 467 tests, 0 failures
- TypeScript: 0 errors
- `git diff --check`: clean

## Known Risks / Blockers

- This is not a roadmap-advancing Phase 2 slice. Once the cleanup is committed, handoff should return to the active `/map` workstation program immediately.
- Phase 1 is now closed. `lib/formatters.ts` `timeAgo()` still falls back to `Date.now()` when called with no `nowMs`; remaining callers (`OrganizationsPage`, `UsersPage`, `correlationRules/types.ts`) are intentionally left on wall-clock as admin/config surfaces, not trust surfaces.

## Open Questions

- Are the initial freshness thresholds still appropriate once more sources are folded into the shared model?
- Should the first detailed source-health view live in the navbar indicator or on an existing commander-only operational surface?

## Do Not Reopen

- Phase 0 — Execution Foundation after these two files are accepted
- Phase 1 Slice 2 shell degraded-state visibility (`d3bf38a`)
- Phase 1 Slice 3 `AssetsPage` freshness adoption
- Phase 1 Slice 4 navbar source-health detail
- Phase 1 Slice 5 `EntityCard` freshness adoption
- Phase 1 Slice 6 operational-health snapshot freshness language
- Phase 1 Slice 7 site timeline reference-time normalization
- Phase 1 Slice 8 incident replay-relative recency
- Phase 1 Slice 9 loitering watchlist live reference-time normalization
- Phase 1 Slice 10 operational health tables shared reference-time adoption
- Phase 1 — Trustworthy Operational Picture (all non-spatial trust surfaces now read the shared live reference clock)
- Phase 2 Slice 1 docked map context panel + viewport re-measurement
- Phase 2 Slice 3 site-scoped unacknowledged-alerts section inside the docked `MapSitePanel` (reusing `useSignalRuleMatches` + `useTransitionAlert`, `canTriage` + shared reference clock threaded through)
- Phase 2 Slice 2 keyboard toggle (`]`) + draggable resize handle (240–600px) + empty-state placeholder for the docked panel
- Inherited-findings infra fixes B-3 (`DB_STATEMENT_TIMEOUT_MS` default 30s) and I-1 (CI concurrency group)
- production-readiness closeout work
- replay parity, auth hardening, and tenant-boundary cleanup that are already closed in the existing memory files
