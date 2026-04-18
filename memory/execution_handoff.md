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

Phase 4 Slice 4b — incident-scoped A-B snapshot diff — IN PROGRESS (uncommitted, stacked on uncommitted 4a)

(Slice 4 is being shipped as three sequential, independently-reviewable tranches: 4a per-event diff, 4b incident-scoped A-B diff, 4c site readiness/tasks diff between two moments. 4a and 4b are both sitting uncommitted in the working tree right now — 4a was gate-reviewed with COMMIT WITH NOTES and a P3 on a brittle CSS-class test query, which 4b absorbs by introducing `data-testid`s on the shared diff view.)

## Objective (Slice 4b)

Give operators a way to see *what changed on a single incident* between two arbitrary timestamps without leaving the incident detail page:
- a new "Compare" tab on `IncidentDetailPage` next to History / Prosecution,
- two `datetime-local` inputs (T1 / T2) defaulting to `opened_at` / `updated_at`,
- a `Compare` button that fetches two snapshots via the already-existing `getIncident(id, { as_of })` — no new API,
- the delta rendered through a shared `SnapshotDiffView` (extracted from 4a's `DebriefEventDiff`) so both surfaces share one diff renderer,
- deliberate field filter (`id`, `updated_at`, `alerts`, `tasks`) so the diff reflects incident-state changes, not mechanical churn or opaque nested collections,
- tab disabled while the operator is in replay mode (stacking temporal semantics is out of scope for this tranche).

Not in scope (4b): no cross-incident comparison, no site-level diff, no task-list diff, no evidence-link diff. Those belong to 4c or a later tranche.

## Completed This Session

Slice 4a implementation (still uncommitted, working tree — unchanged from last handoff):
- **NEW** `frontend/src/utils/diffSnapshots.ts` — pure utility: `diffSnapshots(before, after) -> { added, removed, changed }`, `isDiffEmpty`, `formatDiffValue`. Strict equality via `Object.is` + JSON structural fallback for nested objects/arrays. Sorted output for stable rendering.
- **NEW** `frontend/src/components/DebriefEventDiff.tsx` — thin Blueprint `Drawer` shell (`DrawerSize.SMALL`, right) that now delegates its body to the shared `SnapshotDiffView`. Header still tags entity_type + action, timestamp + actor below.
- **MODIFIED** `frontend/src/components/DebriefPanel.tsx` — wrapped each `<li>` in `.debrief-timeline-row` so the existing reconstruct `<button>` is a flex sibling (not a parent) of a new `.debrief-diff-action` "Show changes" button, avoiding the nested-interactive-button HTML violation. `useMemo` over events to compute a Set of IDs with non-trivial diffs; the action only renders for those. New `diffEvent` state drives the `DebriefEventDiff` drawer.
- **MODIFIED** `frontend/src/index.css` — `.debrief-timeline-row`, `.debrief-diff-action`, and `.debrief-diff-*` drawer styles (color-coded left border per section, monospace before/after codes, Blueprint palette for info/warn/error).
- **NEW** `frontend/src/test/diffSnapshots.test.ts` — 9 tests.
- **NEW** `frontend/src/test/DebriefEventDiff.test.tsx` — 4 tests, now querying `data-testid="diff-before"/"diff-after"` instead of `.debrief-diff-before/after` CSS classes (4a gate P3 closed).
- **MODIFIED** `frontend/src/test/DebriefPanel.test.tsx` — one new test: row with a real `workflow_status: new → resolved` delta shows "Show changes for Task event"; row with null-before + empty-after (a pure read) does not; clicking opens the drawer with the diff rendered.

Slice 4b implementation (uncommitted, stacked on top of 4a):
- **NEW** `frontend/src/components/SnapshotDiffView.tsx` — extracted presentation from `DebriefEventDiff`. Renders Changed / Added / Removed sections with `data-testid="diff-before"/"diff-after"` on before/after cells, Blueprint `NonIdealState` when the diff is empty. Accepts `emptyTitle` + `emptyDescription` so drawer and tab can use different empty copy.
- **NEW** `frontend/src/components/incident-detail/IncidentCompareTab.tsx` — T1/T2 `datetime-local` inputs (local-zone ↔ ISO conversion), no-fetch-until-Compare via `useIncident(..., { enabled: !!active, refetchInterval: false })`, validation state (`T1 >= T2`, missing, unparseable), shared `stripIgnored` field filter on `IGNORED_INCIDENT_FIELDS = { id, updated_at, alerts, tasks }`, hint Callout before first Compare, Spinner while fetching, danger Callout on either snapshot failure, delegate to `SnapshotDiffView` once both snapshots resolve.
- **MODIFIED** `frontend/src/pages/IncidentDetailPage.tsx` — new `<Tab id="compare" title="Compare">` between History and Prosecution, `disabled={isReplaying}` to prevent stacked temporal semantics, passing `incidentId` / `openedAt` / `latestAt` from the already-loaded incident.
- **MODIFIED** `frontend/src/index.css` — `.incident-compare-*` styles (flex-wrap controls, 220px min-width datetime inputs, validation/loading/hint layout).
- **NEW** `frontend/src/test/IncidentCompareTab.test.tsx` — 5 tests: hint state + no fetches pre-Compare; `T1 >= T2` disables Compare + shows validation reason + still no fetches; Compare press fires both `getIncident` calls and renders a Changed section with `status` + `severity`; ignored fields (`updated_at`/`alerts`/`tasks`) produce an empty diff (`No incident changes`); one-snapshot fetch failure surfaces the error Callout. Uses `vi.hoisted(() => vi.fn())` + `vi.importActual` so other `../api/incidents` exports stay intact.

Nothing has been committed yet. No backend, route, or shared-context changes.

## Previously Shipped Under Slice 3

- `45906cb` — debrief rows clickable for `Incident`/`Site`/`Task`/`Asset`, URL-driven `?asset=` drawer on `SiteDetailPage`, row styling, direct test coverage for all four entity branches and the asset drawer round-trip, and an orthogonal `replay-globe.spec.ts` copy realignment (post-push P3: should have been split).
- `d202532` — first hardening pass: `ReconstructableEntityType` + `isReconstructable` type guard, exhaustive switch, `AppToaster` danger toast on lookup failure (replay still enters), monotonic `latestClickToken` ref so a newer click supersedes any in-flight lookup. Tests for the toast and single-flight race.
- `67caf3b` — post-push mentor follow-ups: `ReconstructableEntityType` derived from `typeof RECONSTRUCTABLE_ENTITY_TYPES[number]` (union + runtime check cannot drift); `.catch(() => {})` terminator on the fire-and-forget toaster chain; stale-click test replaced `setTimeout(0)` with `act(async () => resolveTask(...))` + `waitFor` steady-state assertion.

## In Progress

- Slices 4a + 4b uncommitted and stacked. Both green on focused + full Vitest, tsc, and eslint. Ready for `/gate` review (either together as one commit or split — prefer split so 4a's gate history stays intact).

## Next

- Gate + commit 4a and 4b (split commits recommended so each tranche stays independently reviewable).
- Then **Slice 4c — site readiness/tasks diff between two moments**. Scoped to site detail; compares a site's task list + readiness at T1 vs T2. Reuses `SnapshotDiffView` and `diffSnapshots`. Expect a new `stripIgnored` tuned for Site (not all Incident fields map), and possibly a small nested renderer for task-list deltas — if that gets expensive, stop and scope it.
- Do NOT widen 4b to include cross-incident diff, event-to-event comparison, or anything the Compare tab does not need.
- Debrief reconstruction remains scoped to the existing route model; 4c does not introduce a generic time-machine surface.

## Files Changed This Slice (4a + 4b, uncommitted)

Slice 4a:
- `frontend/src/components/DebriefPanel.tsx`
- `frontend/src/components/DebriefEventDiff.tsx` (new, now a thin shell over `SnapshotDiffView`)
- `frontend/src/utils/diffSnapshots.ts` (new)
- `frontend/src/test/DebriefPanel.test.tsx`
- `frontend/src/test/DebriefEventDiff.test.tsx` (new)
- `frontend/src/test/diffSnapshots.test.ts` (new)
- `frontend/src/index.css` (debrief styles)

Slice 4b:
- `frontend/src/components/SnapshotDiffView.tsx` (new — shared across 4a/4b)
- `frontend/src/components/incident-detail/IncidentCompareTab.tsx` (new)
- `frontend/src/pages/IncidentDetailPage.tsx`
- `frontend/src/index.css` (incident-compare styles)
- `frontend/src/test/IncidentCompareTab.test.tsx` (new)

## Currently Locked Files

- none

## Validation Commands

```bash
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run src/test/diffSnapshots.test.ts src/test/DebriefEventDiff.test.tsx src/test/DebriefPanel.test.tsx src/test/IncidentCompareTab.test.tsx
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx tsc -p tsconfig.app.json --noEmit
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx eslint src/components/DebriefPanel.tsx src/components/DebriefEventDiff.tsx src/components/SnapshotDiffView.tsx src/components/incident-detail/IncidentCompareTab.tsx src/pages/IncidentDetailPage.tsx src/utils/diffSnapshots.ts src/test/DebriefPanel.test.tsx src/test/DebriefEventDiff.test.tsx src/test/diffSnapshots.test.ts src/test/IncidentCompareTab.test.tsx
git diff --check
```

## Last Validation Results (2026-04-18, after 4b)

- Focused frontend tests: 29/29 pass (`diffSnapshots.test.ts` 9, `DebriefEventDiff.test.tsx` 4, `DebriefPanel.test.tsx` 11, `IncidentCompareTab.test.tsx` 5)
- Full Vitest suite: **545 tests across 76 files, 0 failures**
- TypeScript (`tsconfig.app.json`): 0 errors
- ESLint on touched frontend files: 0 errors, 0 warnings
- `git diff --check`: clean

## Known Risks / Blockers

- Frontend type-check must use the build-equivalent `tsc -p tsconfig.app.json --noEmit` (or `tsc -b`). The loose root `tsc --noEmit` exits 0 even when app sources fail to compile, because the root `tsconfig.json` is a project-reference shell.
- Focused Vitest runs must be invoked from `frontend/` (not the repo root) or `src/test/setup.ts` won't load, which surfaces as `ReferenceError: document is not defined` + `environment 0ms` for jsdom-dependent tests.
- `IncidentCompareTab` intentionally filters `alerts` / `tasks` from the incident diff because they are nested collections that diff poorly as opaque JSON. If an operator needs "which tasks were added/closed between T1 and T2," that is explicitly Slice 4c territory — do not re-open 4b to smuggle it in.
- The Compare tab is `disabled={isReplaying}` because the query layer would be double-temporal-scoped otherwise (outer replay `as_of` + inner compare `as_of`). If a future slice needs compare-within-replay, rework the query hook explicitly, don't just drop the `disabled` flag.
- Curated debrief event coverage is still manual. New backend event types will not surface automatically; owners must update `MEANINGFUL_DEBRIEF_EVENT_TYPES`. The set of reconstructable entity types is also a single source of truth in `DebriefPanel.tsx` (`ReconstructableEntityType`).
- Debrief reconstruction intentionally enters replay at `event.occurred_at` even when the lookup fails, so the operator can still investigate manually from that timestamp. The failure is surfaced via `AppToaster` — if that assumption changes (e.g. we want hard-fail-no-replay on 403), rework `handleReconstruct` explicitly, don't just remove the toast.
- Local backend validation still requires `TEST_DATABASE_PORT=5434` because the default test DB bootstrap path hits the known `transaction_timeout` / pending-migrations environment mismatch.

## Do Not Reopen

- Phase 0 — Execution Foundation
- Phase 1 — Trustworthy Operational Picture
- Phase 2 Slices 4–7 (triage-in-context, cross-panel coordination, task context)
- Phase 3 Slices 1–4 (freshness rendering, cross-entity highlighting, evidence-linked highlighting)
- Phase 4 Slice 1 — debrief audit events API prerequisites (shipped in `2c49a3c`)
- incident notes/prosecution standalone coverage slice
- replay parity, auth hardening, and tenant-boundary cleanup
- production blocker hardening tranche
