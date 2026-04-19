---
name: execution_handoff
description: Active handoff file for the current phase, slice, validation, and takeover safety
type: project
---

# Resilience — Execution Handoff

Last updated: 2026-04-18

## Current Phase

Phase 4 — Debrief

(Phase 3 — Spatial Analytics + Spatial Trust Rendering is complete and verified honest via `/wtf-roadmap`.)

## Current Slice

Phase 4 Slice 4c-followup — compare-tab hardening from post-push mentor review — IN PROGRESS (uncommitted)

(Slice 4c itself shipped as `eec8439` — pushed. The automated post-push mentor review flagged P2/P3 items that apply to BOTH compare tabs; the "twice-shipped" pattern made these into cross-surface hardening, not one-off polish. This tranche lands those fixes and the matching tests.)

## Objective (Slice 4c-followup)

Close the P2/P3 findings from the automated post-push mentor review on `eec8439`. These all apply to both `IncidentCompareTab` and `SiteCompareTab` — the review flagged that the second-ship of the pattern made them cross-surface hardening, not one-off polish. Specifically:
- **P2-a (stale-compare UX):** any input edit after Compare now clears `active` so the previously-rendered diff can't linger as a misread signal for the new window. Implemented at the input `onChange` layer (not via `useEffect`) because the `react-hooks/set-state-in-effect` rule correctly rejects setState-cascade-in-effect, and onChange-driven clearing is the React-canonical way to respond to user input. New test on both tabs: press Compare → assert diff renders → edit T1 → assert diff gone + hint callout returns → re-press Compare → assert fresh diff renders.
- **P2-b (shared datetime-local helpers):** `toDatetimeLocal` / `fromDatetimeLocal` were duplicated in both compare tabs. Extracted to `frontend/src/utils/datetimeLocal.ts`. Second consumer is the correct extraction threshold.
- **P3-a (rename `latestAt` → `defaultLatestAt`):** makes the "this is a seed value, not a fixed bound" semantics explicit. Propagated through both compare tabs, both caller pages, and both test files.
- **P3-b (empty-state copy on SiteCompareTab):** the NonIdealState description now enumerates the checked buckets ("status, flag, geofence, AO assignment, readiness score, task counts") and the exclusions ("coordinates and mechanical timestamps") so an operator can read the empty diff as "we checked X and nothing changed," not "we didn't check anything."
- **P3-c (future-abstraction comment):** added a comment in `SiteCompareTab` naming the `useSnapshotAtMoment(entityFetcher, id, asOf, enabled)` extraction as the correct next step at the fourth compare consumer — not now, explicitly.

Not in scope (this tranche): P3-d (incremental loading per-fetch — deferred until an operator surfaces latency feedback). Deferred mentor P2 on `eventsWithDiff` short-circuit in `DebriefPanel` remains deferred.

## Completed This Session

4c-followup hardening (uncommitted, working tree):
- **NEW** `frontend/src/utils/datetimeLocal.ts` — shared `toDatetimeLocal(iso)` and `fromDatetimeLocal(value)` helpers, extracted from the duplicated definitions in both compare tabs (P2-b).
- **MODIFIED** `frontend/src/components/incident-detail/IncidentCompareTab.tsx` — imports shared helpers, renames prop `latestAt` → `defaultLatestAt` (P3-a), adds `handleT1Change` / `handleT2Change` that clear `active` on any input edit after Compare (P2-a, onChange-based to satisfy `react-hooks/set-state-in-effect`).
- **MODIFIED** `frontend/src/components/site-detail/SiteCompareTab.tsx` — same refactor as the incident tab (shared helpers import, `defaultLatestAt` rename, onChange-based stale-compare guard), plus the enumerated empty-state copy on `<SnapshotDiffView>` (P3-b) and the future-abstraction comment naming `useSnapshotAtMoment` as the extraction target at the fourth consumer (P3-c).
- **MODIFIED** `frontend/src/pages/IncidentDetailPage.tsx` — `latestAt={incident.updated_at}` → `defaultLatestAt={incident.updated_at}`.
- **MODIFIED** `frontend/src/pages/SiteDetailPage.tsx` — `latestAt={site.updated_at}` → `defaultLatestAt={site.updated_at}`.
- **MODIFIED** `frontend/src/test/IncidentCompareTab.test.tsx` — 5 `latestAt=` → `defaultLatestAt=`, plus a new "clears the rendered diff when the operator edits T1/T2 after pressing Compare" test (Compare → assert Changed → edit T1 → assert Changed gone + hint returns → re-Compare → assert Changed back).
- **MODIFIED** `frontend/src/test/SiteCompareTab.test.tsx` — 6 `latestAt=` → `defaultLatestAt=`, plus a matching stale-compare test. The mock keys off T2's fixed `2026-04-15` prefix (not T1's `2026-04-01`) so both the pre-edit and post-edit T1 values land in the same "inactive" branch and both Compare presses produce a non-empty diff.

No behavior change in `SnapshotDiffView`, `diffSnapshots`, backend, routes, or shared context. No new API.

## Previously Shipped This Phase

- `eec8439` (Phase 4 Slice 4c — pushed) — `SiteCompareTab` with four-query site + readiness fetch, `SnapshotDiffView` + compare-tab CSS renamed at the third consumer, `SiteDetailPage` Compare tab disabled during replay, 6 new SiteCompareTab tests + replay-disabled tests on both detail pages.
- `8ebedf9` (Phase 4 Slice 4a + 4b — pushed) — `diffSnapshots` utility, `DebriefEventDiff` drawer + `.debrief-diff-action` row button, `SnapshotDiffView` shared renderer, `IncidentCompareTab` with four-query setup + T1/T2 datetime-local inputs + field filter, Compare tab wired into `IncidentDetailPage` disabled during replay, 29 new focused tests (9 diffSnapshots + 4 DebriefEventDiff + 11 DebriefPanel updates + 5 IncidentCompareTab).
- `2c49a3c` (earlier in Phase 4 Slice 1) — debrief audit events API prerequisites and backend plumbing.

## In Progress

- 4c-followup hardening uncommitted in working tree. Full Vitest + tsc + eslint green. Ready for `/gate` review.

## Next

- Gate + commit 4c-followup.
- Then Phase 4 Slice 5 (if the roadmap continues debrief expansion) or start the next phase in `execution_context.md`. Defer per-task identity diff ("which tasks changed between T1 and T2") until an operator surfaces an actual need — that work would require a new collection-diff utility and is explicitly out of 4c scope.
- Remaining mentor P2/P3 items still deferred (not blocking):
  - **P2 (from 4a+4b review):** optimize `eventsWithDiff` useMemo in `DebriefPanel` with a short-circuit helper so we don't build full diff objects just to check emptiness.
  - **P3-d (from 4c review):** incremental loading per-fetch in `SiteCompareTab` (today all four queries must resolve before anything renders). Defer until an operator surfaces latency feedback.

## Files Changed This Tranche (4c-followup, uncommitted)

- `frontend/src/utils/datetimeLocal.ts` (new)
- `frontend/src/components/incident-detail/IncidentCompareTab.tsx` (shared-helper import, `defaultLatestAt` rename, onChange-based stale-compare guard)
- `frontend/src/components/site-detail/SiteCompareTab.tsx` (shared-helper import, `defaultLatestAt` rename, onChange-based stale-compare guard, enumerated empty-state copy, future-abstraction comment)
- `frontend/src/pages/IncidentDetailPage.tsx` (prop rename propagation)
- `frontend/src/pages/SiteDetailPage.tsx` (prop rename propagation)
- `frontend/src/test/IncidentCompareTab.test.tsx` (prop rename + stale-compare test)
- `frontend/src/test/SiteCompareTab.test.tsx` (prop rename + stale-compare test)

## Currently Locked Files

- none

## Validation Commands

```bash
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run src/test/IncidentCompareTab.test.tsx src/test/SiteCompareTab.test.tsx
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx tsc -p tsconfig.app.json --noEmit
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx eslint src/components/incident-detail/IncidentCompareTab.tsx src/components/site-detail/SiteCompareTab.tsx src/utils/datetimeLocal.ts src/test/IncidentCompareTab.test.tsx src/test/SiteCompareTab.test.tsx src/pages/IncidentDetailPage.tsx src/pages/SiteDetailPage.tsx
git diff --check
```

## Last Validation Results (2026-04-18, after 4c-followup)

- Focused frontend tests: 13/13 pass (`IncidentCompareTab.test.tsx` 6, `SiteCompareTab.test.tsx` 7 — each file gained one stale-compare test)
- Full Vitest suite: **555 tests across 77 files, 0 failures**
- TypeScript (`tsconfig.app.json`): 0 errors
- ESLint on touched frontend files: 0 errors, 0 warnings

## Known Risks / Blockers

- Frontend type-check must use the build-equivalent `tsc -p tsconfig.app.json --noEmit` (or `tsc -b`). The loose root `tsc --noEmit` exits 0 even when app sources fail to compile, because the root `tsconfig.json` is a project-reference shell.
- Focused Vitest runs must be invoked from `frontend/` (not the repo root) or `src/test/setup.ts` won't load, which surfaces as `ReferenceError: document is not defined` + `environment 0ms` for jsdom-dependent tests.
- `SiteCompareTab` uses `useQuery` directly (bypassing `useSite` / `useReadiness` hooks) because those hooks carry `refetchInterval` / `enabled` defaults that don't fit no-fetch-until-Compare. Any test harness that renders `SiteDetailPage` eagerly (Blueprint renders all tab panels) must either wrap with a `QueryClientProvider` or `vi.mock` the Compare tab — `SiteDetailPage.test.tsx` takes the mock route.
- `SiteCompareTab` intentionally merges site + readiness scalar fields into one flat diff. If an operator asks "which specific tasks were added or closed between T1 and T2," that is an explicit future slice — do not smuggle a task-list renderer into 4c. It would need a collection-diff helper that matches tasks across snapshots by identity, not by position.
- The Compare tab is `disabled={isReplaying}` on both surfaces because the query layer would be double-temporal-scoped otherwise (outer replay `as_of` + inner compare `as_of`). If a future slice needs compare-within-replay, rework the query hook explicitly, don't just drop the `disabled` flag.
- If readiness has no entry for this site on either side (e.g. site was freshly created without readiness computed yet), the diff simply does not include the readiness keys on that side. This is correct — we do not fabricate zero-counts.
- Curated debrief event coverage is still manual. New backend event types will not surface automatically; owners must update `MEANINGFUL_DEBRIEF_EVENT_TYPES`. The set of reconstructable entity types is also a single source of truth in `DebriefPanel.tsx` (`ReconstructableEntityType`).
- Debrief reconstruction intentionally enters replay at `event.occurred_at` even when the lookup fails, so the operator can still investigate manually from that timestamp. The failure is surfaced via `AppToaster` — if that assumption changes (e.g. we want hard-fail-no-replay on 403), rework `handleReconstruct` explicitly, don't just remove the toast.
- Local backend validation still requires `TEST_DATABASE_PORT=5434` because the default test DB bootstrap path hits the known `transaction_timeout` / pending-migrations environment mismatch.

## Do Not Reopen

- Phase 0 — Execution Foundation
- Phase 1 — Trustworthy Operational Picture
- Phase 2 Slices 4–7 (triage-in-context, cross-panel coordination, task context)
- Phase 3 Slices 1–4 (freshness rendering, cross-entity highlighting, evidence-linked highlighting)
- Phase 4 Slice 1 — debrief audit events API prerequisites (shipped in `2c49a3c`)
- Phase 4 Slices 4a + 4b — per-event snapshot diff drawer + incident-scoped A-B compare (shipped in `8ebedf9`)
- Phase 4 Slice 4c — site readiness/tasks A-B compare (shipped in `eec8439`)
- incident notes/prosecution standalone coverage slice
- replay parity, auth hardening, and tenant-boundary cleanup
- production blocker hardening tranche
