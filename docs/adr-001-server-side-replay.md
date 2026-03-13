# ADR-001: Server-Side Replay via as_of Query Parameter

**Status:** Accepted
**Date:** 2026-03-13

## Context

The Resilience console must support time-based replay: the ability to view the
complete operational state as it existed at any past point in time. This includes
task lists, site details, readiness scores, and the map view.

Two architecturally distinct approaches exist:

### Option A: Client-side replay (rejected)
Download all audit events to the frontend. Reduce them locally in the browser
to reconstruct past state using an event-sourcing pattern.

### Option B: Server-side replay via projection (accepted)
The backend accepts an optional `as_of` timestamp on read endpoints. When
present, the backend projects the data at that point in time by reconstructing
entity state from audit events, returning a normal response body. The frontend
sees no difference in response shape — it simply passes an `as_of` param.

## Decision

We adopt **Option B: server-side replay** for the following reasons:

1. **Correctness is centralized.** Replay logic lives in one place
   (`ReplayProjectionService`, implemented in Phase 2). The frontend
   does not need to implement or maintain a local event reducer.

2. **Simpler frontend state model.** React Query cache keys include `as_of`
   naturally. No need for a complex local event store or custom cache invalidation.

3. **Testability.** Server-side projection is straightforward to test with
   RSpec request specs. Client-side event reduction is harder to test and more
   likely to diverge from the backend's understanding of state.

4. **Consistency across all surfaces.** The task list, readiness scores, and
   map view all query the same backend projections at the same `as_of` timestamp.
   With client-side replay, keeping map state, task state, and readiness state
   synchronized at a past timestamp would require careful coordination.

5. **Future extensibility.** If we add new entity types, replay correctness
   is guaranteed by extending the server-side projection service. With client-side
   replay, new reducers would need to be written and kept in sync on the frontend.

## Consequences

- All read endpoints that return mutable state accept an optional `as_of`
  query parameter (`?as_of=<ISO8601 timestamp>`).

- `as_of` is ignored for purely current-state writes (transitions, creates).

- The `ReplayProjectionService` will be implemented in Phase 2 alongside
  the REST endpoint layer.

- Frontend cache keys must include `as_of` to correctly invalidate cached
  responses when the operator changes the replay timestamp.

- Performance: deep historical replay for very large audit logs may require
  indexing work. The `(occurred_at)` and `(entity_type, entity_id, occurred_at)`
  indexes on `audit_events` provide the foundation. This is acceptable for MVP.

## What this is NOT

This is not an event-sourced architecture in the strict sense. The primary
system of record is the current state in the `tasks`, `sites`, and `assets`
tables. The audit log supports replay as a secondary projection capability,
not as the primary read model.
