# ADR-003: Multi-Tenant Authorization via Named Boundary Helpers

**Status:** Accepted
**Date:** 2026-04-23

## Context

Resilience is multi-tenant along two axes: `Organization` (the primary tenant
boundary) and `AreaOfOperation` (a sub-tenant, geographic / command scope
that can be pinned to a user). A viewer in one AO must not see sites, tasks,
assets, or audit events belonging to another. An org-scoped commander must
not see another organization's data at all. Admins are unrestricted.

Three authorization concerns must be enforced consistently across every one
of 36 API controllers:

1. **Collection-level scope.** When the client reads `/api/sites`, the
   response must be limited to records the caller can see.
2. **Record-level access.** When the client reads `/api/sites/:id`, the
   request must be denied with 403 if the caller isn't allowed that record.
3. **Action-level permission.** Mutations require specific roles
   (commander-only for rule creation, admin-only for user management, etc.).

Two architectural shapes exist for implementing this.

### Option A: Raw attribute checks at call sites (rejected)

Pattern: `return unless record.organization_id == current_user.organization_id`
scattered across controllers and services as needed. Familiar to most
Rails developers, no framework dependency.

**Why rejected.** The sprawl is guaranteed to diverge. Each call site
interprets "accessible" slightly differently: some check org-only, some
check AO-too, some forget that admins are unrestricted, some forget that
org-null global AOs should be visible on the AO catalog surface but not
when the AO is attached to operational data. This is exactly the class of
multi-tenancy bug that gets shipped to production and only surfaces as a
compliance finding.

### Option B: Pundit policies with **named boundary helpers** (accepted)

Every controller uses Pundit (`authorize record` / `policy_scope(Model)`),
every policy inherits from `ApplicationPolicy`, and the common tenant-
boundary logic lives in **named helper methods** on the base class. Policy
methods call the named helpers; they never reference `organization_id`
directly.

The critical discipline: **there are multiple valid boundary semantics**,
and each gets its own named helper. Two examples:

- `area_of_operation_surface_accessible?(ao_or_id)` — includes org-null
  global AOs when a user's org is set. Used by the AO catalog surface
  itself (where global overlays should be visible).
- `owned_area_of_operation_accessible?(ao_or_id)` — excludes org-null
  globals. Used by policies for doctrine and operational data attached
  to an AO (which must remain tenant-owned regardless of AO visibility).

Both are ultimately backed by the same `area_of_operation_accessible?`
primitive with an `include_global:` flag, but policy code never passes
the flag directly — it picks the named variant that matches its intent.

## Decision

Adopt **Option B** with the following enforcement pattern:

1. **`verify_authorized` after-action** in `BaseController` makes
   forgetting-to-authorize a deploy-time error. Any action that doesn't
   call `authorize` or `policy_scope` raises `Pundit::AuthorizationNotPerformedError`.

2. **`ApplicationPolicy` holds the named helpers.** Policies inherit from
   it and compose the helpers; they never re-derive tenant boundaries
   from raw attributes.

3. **Matching `Scope` helpers** for collection filtering (`org_filter`,
   `ao_filter_via_site`, `area_of_operation_scope`) mirror the record-
   access helpers. The scope applied to a collection read must enforce
   the same boundary as the record-access check applied to a detail read.

4. **Policy-scope specs are a separate test category.** Dedicated request
   specs prove that org-A users cannot read org-B records at the API
   level, not just at the model level.

## Consequences

- **30 Pundit policies** covering every mutable and scoped resource.
  Each is a small file; the complexity lives in the named helpers.

- **Two-tier boundary semantics naturally emerge** (owned vs surface).
  A new contributor reading the helpers learns the distinction explicitly
  rather than re-discovering it by reading ten different policies.

- **Admin role is handled at the helper level** (`scope_restricted?`
  returns false when the user has neither `organization_id` nor
  `area_of_operation_id`). Admins do not need an explicit bypass in
  every policy.

- **Performance.** Helpers issue at most one extra query per record
  (for the AO-surface branch that checks `AreaOfOperation.joins(:sites)`).
  The hot-path Scope helpers operate at the SQL level, not Ruby.

- **Testing surface.** Org-isolation specs, scoped-access request specs,
  and role-boundary E2E specs exercise the helpers end-to-end. If a
  policy accidentally stops using the named helper and reaches for
  `organization_id` directly, these specs are the catch.

## What this is NOT

This is not a wholesale ABAC or ReBAC framework. Authorization is role-
plus-tenant-plus-AO. No complex attribute expressions, no dynamic policy
compilation. The discipline is in the consistency of the boundary helpers,
not in the sophistication of the policy language.
