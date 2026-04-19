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

Phase 4 Slice 4c — site readiness/tasks diff between two moments — IN PROGRESS (uncommitted)

(Slice 4 is being shipped as three sequential, independently-reviewable tranches: 4a per-event diff, 4b incident-scoped A-B diff, 4c site readiness/tasks diff between two moments. 4a + 4b were committed together as `8ebedf9` (pushed). 4c now sits uncommitted in the working tree.)

## Objective (Slice 4c)

Give operators a way to see *what changed on a single site — including readiness posture — between two arbitrary timestamps* without leaving the site detail page:
- a new "Compare" tab on `SiteDetailPage` next to Timeline / Audit,
- two `datetime-local` inputs (T1 / T2) defaulting to `created_at` / `updated_at`,
- a `Compare` button that fetches two site snapshots via `getSite(id, { as_of })` **plus** two readiness snapshots via `getReadiness({ as_of })` — no new API,
- the delta rendered through the shared `SnapshotDiffView` so all three Slice 4 surfaces share one diff renderer,
- deliberate field filter (`id`, `created_at`, `updated_at`, `latitude`, `longitude`) so the diff reflects operational state (status, flag, geofence, AO) and not serialization churn,
- readiness flattened into scalar keys (`readiness_score`, `tasks_total`, `tasks_resolved`, `tasks_blocked`, `tasks_in_progress`, `tasks_new`, `tasks_triaged`) merged into the same diff as the site scalar fields, so operators see "status: inactive → active" and "tasks_resolved: 3 → 8" in one place,
- tab disabled while the operator is in replay mode (stacked temporal semantics remain explicitly out of scope for Slice 4 tranches),
- shared CSS renamed once, at the point of the third consumer: `.debrief-diff-*` → `.snapshot-diff-*` in `SnapshotDiffView`, and `.incident-compare-*` → `.compare-tab-*` on the tab chrome. This closes mentor P2 from the 4a+4b post-push review.

Not in scope (4c): no per-task identity diff (which specific tasks were added / closed — would need a collection-diff utility), no cross-site comparison, no evidence-link diff. Those belong to a later slice.

## Completed This Session

Slice 4c implementation (uncommitted, working tree):
- **RENAMED** `frontend/src/components/SnapshotDiffView.tsx` — all internal class names from `.debrief-diff-*` → `.snapshot-diff-*`. `data-testid="diff-before"` / `data-testid="diff-after"` preserved.
- **MODIFIED** `frontend/src/index.css` — split into three labeled sections: debrief-drawer-specific chrome (`.debrief-diff-meta`, `.debrief-diff-timestamp`, `.debrief-timeline-row`, `.debrief-diff-action`), shared snapshot-diff renderer (`.snapshot-diff-*`), and shared A-B compare tab chrome (`.compare-tab-*`).
- **MODIFIED** `frontend/src/components/incident-detail/IncidentCompareTab.tsx` — class references updated from `incident-compare-*` → `compare-tab-*`. Logic unchanged.
- **NEW** `frontend/src/components/site-detail/SiteCompareTab.tsx` — four `useQuery` calls (site T1/T2 + readiness T1/T2) with `enabled: !!active` and `refetchInterval: false`, `IGNORED_SITE_FIELDS = { id, created_at, updated_at, latitude, longitude }`, `readinessSnapshot()` helper that flattens `SiteReadiness.counts` into scalar `tasks_*` keys plus `readiness_score` and finds the current site's readiness entry by `site_id`, validation Callout on `T1 >= T2` / missing / unparseable, hint Callout before first Compare, Spinner while any of the four queries is pending, danger Callout on any failure, delegate to `SnapshotDiffView` once all four snapshots resolve. If readiness has no entry for this site on either side, those keys simply do not appear in the diff — we do not fabricate zero-counts the operator didn't ask for.
- **MODIFIED** `frontend/src/pages/SiteDetailPage.tsx` — new `<Tab id="compare" title="Compare">` between Timeline and Audit, `disabled={isReplaying}`, passing `siteId` / `openedAt=site.created_at` / `latestAt=site.updated_at`.
- **NEW** `frontend/src/test/SiteCompareTab.test.tsx` — 6 tests: hint + no fetches pre-Compare; `T1 >= T2` disables Compare + surfaces validation reason + still no fetches; Compare press fires both site fetches + both readiness fetches and renders Changed rows for `status` / `geofence radius km` / `readiness score` / `tasks resolved` / `tasks blocked` plus `flag reason` (Changed, not Added, because the key exists in both snapshots with null → value); ignored fields (`updated_at`) produce `No site changes`; readiness snapshot failure surfaces the error Callout; missing readiness entry for this site on both sides produces an empty diff (honest answer — no fabricated zero-counts). Uses `vi.hoisted(() => vi.fn())` + `vi.importActual` for `../api/sites` and `../api/readiness` so other exports stay intact.
- **MODIFIED** `frontend/src/test/IncidentDetailPage.test.tsx` — new "disables the Compare tab during replay to prevent stacked temporal semantics" test, asserts `aria-disabled="true"` on the Compare tab when `mockState.isReplaying = true`.
- **MODIFIED** `frontend/src/test/SiteDetailPage.test.tsx` — new matching replay-disabled test, plus `vi.mock('../components/site-detail/SiteCompareTab', ...)` stub so this deep-link harness doesn't need a QueryClientProvider (the Compare tab's own behavior is covered in `SiteCompareTab.test.tsx`).

Nothing has been committed yet for 4c. No backend, route, or shared-context changes.

## Previously Shipped This Phase

- `8ebedf9` (Phase 4 Slice 4a + 4b — pushed) — `diffSnapshots` utility, `DebriefEventDiff` drawer + `.debrief-diff-action` row button, `SnapshotDiffView` shared renderer, `IncidentCompareTab` with four-query setup + T1/T2 datetime-local inputs + field filter, Compare tab wired into `IncidentDetailPage` disabled during replay, 29 new focused tests (9 diffSnapshots + 4 DebriefEventDiff + 11 DebriefPanel updates + 5 IncidentCompareTab).
- `2c49a3c` (earlier in Phase 4 Slice 1) — debrief audit events API prerequisites and backend plumbing.

## In Progress

- Slice 4c uncommitted in working tree. Full Vitest + tsc + eslint green. Ready for `/gate` review.

## Next

- Gate + commit 4c.
- Then Phase 4 Slice 5 (if the roadmap continues debrief expansion) or start the next phase in `execution_context.md`. Defer per-task identity diff ("which tasks changed between T1 and T2") until an operator surfaces an actual need — that work would require a new collection-diff utility and is explicitly out of 4c scope.
- Mentor P2 items from the 4a+4b post-push review that remain open (deferred, not blocking):
  - Optimize `eventsWithDiff` useMemo in `DebriefPanel` with a short-circuit helper so we don't build full diff objects just to check emptiness.
  - Consider a stale-compare UX on both Compare tabs (clear `active` when the operator edits inputs, or badge the rendered diff as stale).
  - Rename `latestAt` prop to `defaultLatestAt` to make the "this is a default seed, not a fixed bound" semantics explicit.

## Files Changed This Slice (4c, uncommitted)

- `frontend/src/components/SnapshotDiffView.tsx` (renamed internal classes)
- `frontend/src/components/incident-detail/IncidentCompareTab.tsx` (updated class references)
- `frontend/src/components/site-detail/SiteCompareTab.tsx` (new)
- `frontend/src/pages/SiteDetailPage.tsx` (new Compare tab)
- `frontend/src/index.css` (rename + new site-compare styles, section headers added)
- `frontend/src/test/SiteCompareTab.test.tsx` (new, 6 tests)
- `frontend/src/test/SiteDetailPage.test.tsx` (replay-disabled test + SiteCompareTab stub)
- `frontend/src/test/IncidentDetailPage.test.tsx` (replay-disabled test)

## Currently Locked Files

- none

## Validation Commands

```bash
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run src/test/SiteCompareTab.test.tsx src/test/IncidentDetailPage.test.tsx src/test/SiteDetailPage.test.tsx src/test/IncidentCompareTab.test.tsx src/test/DebriefPanel.test.tsx
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx tsc -p tsconfig.app.json --noEmit
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx eslint src/components/site-detail/SiteCompareTab.tsx src/components/incident-detail/IncidentCompareTab.tsx src/components/SnapshotDiffView.tsx src/pages/SiteDetailPage.tsx src/test/SiteCompareTab.test.tsx src/test/SiteDetailPage.test.tsx src/test/IncidentDetailPage.test.tsx
git diff --check
```

## Last Validation Results (2026-04-18, after 4c)

- Focused frontend tests: 35/35 pass (`SiteCompareTab.test.tsx` 6, `IncidentDetailPage.test.tsx` 9, `SiteDetailPage.test.tsx` 4, `IncidentCompareTab.test.tsx` 5, `DebriefPanel.test.tsx` 11)
- Full Vitest suite: **553 tests across 77 files, 0 failures**
- TypeScript (`tsconfig.app.json`): 0 errors
- ESLint on touched frontend files: 0 errors, 0 warnings
- `git diff --check`: clean

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
- incident notes/prosecution standalone coverage slice
- replay parity, auth hardening, and tenant-boundary cleanup
- production blocker hardening tranche
