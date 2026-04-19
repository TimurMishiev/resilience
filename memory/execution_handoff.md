---
name: execution_handoff
description: Active handoff file for the current phase, slice, validation, and takeover safety
type: project
---

# Resilience — Execution Handoff

Last updated: 2026-04-19

## Current Phase

Phase 5 — Evidence Threading

(Phase 4 — Debrief closed. Slices shipped so far in Phase 5: Slice 1 (`e1632fc`), Slice 2-A-full (`024af49`), Slice 2-A-followup (`9b8614c`), Slice 2-B (`0ffec30`).)

## Current Slice

**None active — 5-2C is the proposed next slice.** Phase 5 validation checklist is 4-of-5 complete; only "stale evidence/basis can be surfaced" remains before Phase 5 can honestly close. Prerequisite satisfied: `FreshnessState` / `deriveFreshness` / `connectionToFreshness` already exist in `frontend/src/lib/freshness.ts` (Phase 1). 5-2C reuses that model — no new API or type required.

Scope note for completed 5-2B: `/globe` was intentionally excluded. `GlobeInspectorPanel` does not render `SignalRuleMatch` rows today (it shows nearest `Signal`s, not alerts). Adding alert rows to the globe is a separate slice, not part of 5-2B.

## Current Repo State

- Latest shipped slice: `0ffec30` — Phase 5 Slice 2-B: map alert evidence chain affordance
- Working tree: clean
- For the literal tip SHA, run `git log -1` — it is intentionally not recorded here (self-referential with the commit that writes it).

## Phase 5 Slice 2 — Remaining Options

Slice 1 delivered incident → alert threading. Slice 2-A-full delivered rec → evidence-label + rec → alert-chain threading. Slice 2-B delivered map alert-row → alert-chain. Remaining candidates:

- **5-2C — stale-basis surfacing:** annotate evidence (rec or alert drawer) with a stale-evidence indicator when the backing signal/rule/site has aged past its freshness window, reusing the Phase 1 trust/freshness model. Prerequisite: confirm where staleness is computed today and whether the drawer already has the inputs.
- **5-2B-globe (optional) — globe alert evidence context:** would require first adding alert rows to the globe inspector (not present today). Not a natural 5-2B increment; treat as a separate slice only if an operator use-case warrants it.

## Shipped In This Phase

- `e1632fc` — Phase 5 Slice 1: incident alert evidence access
- `024af49` — Phase 5 Slice 2-A-full: recommendation evidence access (labels + alert chain drill-through)
- `9b8614c` — Phase 5 Slice 2-A-followup: apply replay `fired_at <= as_of` filter uniformly to alert evidence labels (closes gate-flagged P3)
- `0ffec30` — Phase 5 Slice 2-B: wire AlertChainDrawer into map alert rows (site + signal panels)

## Shipped In Prior Phases (Phase 4 context)

- `2c49a3c` — Phase 4 Slice 1: debrief audit-events API prerequisites
- `afd68b7` — Phase 4 Slice 2: commander-only debrief timeline page
- `45906cb`, `d202532`, `67caf3b`, `70b3de4` — Phase 4 Slice 3: click-to-reconstruct + hardening
- `8ebedf9` — Phase 4 Slices 4a + 4b: temporal diff surfaces + incident A/B compare
- `eec8439` — Phase 4 Slice 4c: site A/B compare
- `7ba0155` — Phase 4 Slice 4c-followup: compare-tab hardening

## In Progress

- None. Awaiting direction for next slice.

## Next

- **5-2C — stale-basis surfacing.** Annotate the signal node in `AlertChainDrawer` with a stale-basis indicator when the backing signal has aged past its freshness window. Reuse `lib/freshness.ts` (`deriveFreshness`, `FreshnessState`). Do not introduce a new API — thresholds already exist (agingMs: 30_000, staleMs: 120_000).
  - **Drawer ownership decision:** `AlertChainDrawer` is the single owner of stale-basis rendering. `EvidenceDrawer` does not reimplement it — it inherits transparently via its nested `AlertChainDrawer` mount (`EvidenceDrawer.tsx:172`). This prevents double-paint when the operator drills `EvidenceDrawer → AlertChainDrawer` on `/recommendations`.
  - **Row cue placement decision:** on `MapSignalAlertsSection` / `MapSiteAlertsSection` alert rows, the ambient cue is a `Tag minimal` with freshness intent (aging → `warning`, stale → `danger`) rendered inline next to `timeAgo(match.fired_at, referenceTimeMs)` in the existing `.map-site-alert-meta` line. Rationale: stale-basis is a temporal qualifier on the signal's age, so it attaches to the time string. Row-level intent (left border / row background) would collide with confidence/workflow semantics; a free-floating tag elsewhere on the row would compete with the existing workflow tag.
  - **Out of scope:** do not repaint spatial trust on the map layer (Phase 3 surface). Do not add a new field to the `SignalRuleMatch` API response — staleness is derived client-side from `signal.occurred_at` and the same reference clock the drawer already uses. Never wall-clock.
  - **Replay invariant:** stale-basis must be computed off `signal.occurred_at` relative to the drawer's existing reference clock (the same one that feeds `timeAgo`). In replay contexts, this is the `as_of` reference, not `Date.now()`. The two Map alert sections already null-render during replay, so the row cue is live-only by construction.
- After 5-2C lands, close Phase 5 and open Phase 6 (Performance Characterization). Phase 6 gap: `yarn benchmark:map` script + spec do not exist yet (`benchmark:globe` does); documented budgets + CI threshold assertions also pending.
- Phase 7 (advanced geospatial tools — measurement, annotation, temporary overlays) remains unstarted and is intentionally sequenced after Phase 6.

## Currently Locked Files

- none

## Validation Commands

```bash
cd /Users/timurmishiev/Desktop/Code/resilience/backend && TEST_DATABASE_PORT=5434 /Users/timurmishiev/.rbenv/shims/bundle exec rspec spec/requests/api/recommendations_spec.rb
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run src/test/MapSiteAlertsSection.test.tsx src/test/MapSignalAlertsSection.test.tsx
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx tsc -p tsconfig.app.json --noEmit
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx eslint src/components/MapSiteAlertsSection.tsx src/components/MapSignalAlertsSection.tsx src/test/MapSiteAlertsSection.test.tsx src/test/MapSignalAlertsSection.test.tsx
git -C /Users/timurmishiev/Desktop/Code/resilience diff --check
```

## Last Validation Results (Phase 5 Slice 2-B, 2026-04-19, post-commit via `/gate`)

- Focused Vitest (`MapSiteAlertsSection` + `MapSignalAlertsSection`): **25 examples, 0 failures** (+2 new)
- Full Vitest suite: **562 tests across 79 files, 0 failures** (was 560 on 5-2A-followup)
- TypeScript (`tsconfig.app.json`): **0 errors**
- ESLint on touched files: **0 issues**
- Full RSpec suite: **2169 examples, 0 failures**
- `git diff --check`: **clean**

## Known Risks / Blockers

- Backend local validation still needs the repo Ruby path:
  - `TEST_DATABASE_PORT=5434 /Users/timurmishiev/.rbenv/shims/bundle exec ...`
  - the system `bundle` path still fails on the known Bundler `2.7.2` mismatch
- Frontend type-check must continue using:
  - `npx tsc -p tsconfig.app.json --noEmit`
  - the loose root `tsc --noEmit` is not authoritative for this repo
- **`AlertChainDrawer` mount convention on `/map`.** Each of `MapSignalAlertsSection` and `MapSiteAlertsSection` mounts its own `AlertChainDrawer` instance with local state. Safe today because `MapSignalPanel` and `MapSitePanel` are mutually exclusive in `MapSelectionPanels` — only one is rendered at any time, so only one drawer exists in the tree. If a future slice mounts both panels simultaneously, or mounts `EvidenceDrawer` on `/map` (which itself nests an `AlertChainDrawer`), reconcile to a single coordinator at `MapPage` or `MapSelectionPanels` level. Same reconciliation note as 5-2A.
- Both sections already null-render during replay (`if (isReplaying) return null`). The Chain button therefore never appears in replay, which matches `AlertChainDrawer`'s existing design (never opened from a replay context). If a future surface renders alert rows during replay, the chain drawer's replay semantics need to be re-evaluated.
- Evidence resolution is scoped to the `/api/recommendations` surface only. It does **not** widen any other API that happens to render raw `evidence` JSONB.
- Replay intentionally returns both `alert: null` and `label: null` for matches whose `fired_at > as_of`. Do not "helpfully" fall back to live state — that would leak future state into replay.
- Handoff never records the tip SHA — it would be self-referential with the commit that writes it. Product-commit SHAs live in "Shipped In This Phase"; run `git log -1` for the literal tip.

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
- Phase 5 Slice 1 — incident alert evidence access
- Phase 5 Slice 2-A-full — recommendation evidence access
- Phase 5 Slice 2-A-followup — replay fired_at filter on alert evidence labels
- Phase 5 Slice 2-B — map alert evidence chain affordance
- project-skill consolidation / deep-review removal / repo-managed `.claude/skills`
