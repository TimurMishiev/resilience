# ADR-006: Multi-Tenancy Contract — Admin Role Required for Unrestricted Access

**Status:** Accepted (contract documented; structural enforcement deferred)
**Date:** 2026-04-25

## Context

The third-pass CTO review (2026-04-24) flagged a real production footgun
in the policy layer:

```ruby
def scope_restricted?
  user.organization_id.present? || user.area_of_operation_id.present?
end
```

This treats *any* user without `organization_id` and without
`area_of_operation_id` as unrestricted. The intended caller is an admin
— but a misconfigured non-admin user (a viewer/operator/commander whose
scope was accidentally cleared, or a user record created via a path
that forgot to assign scope) **silently receives global read access**.
Same effective permission level as an admin, with no audit trail and
no operator-visible warning.

The reviewer's exact words: *"unscoped users effectively see global
data; that is dangerous as a production default."*

This is a real concern for any multi-tenant deployment. It is also
**not** an issue in current production usage because the only
user-creation path (admin-managed via `/api/users`) requires an
explicit organization. The footgun is latent — would only fire if a
new user-creation path is added that omits scope, or if a data
migration clears scope on existing non-admin users.

## Decision

**The contract is documented; mechanical enforcement is deferred.**

### The contract

A user is unrestricted (sees global data across all tenants) **if and
only if** they hold the `admin` role. Every other role
(`viewer`, `operator`, `commander`) **must** carry at least one of:

- `organization_id` (org-tenant scope)
- `area_of_operation_id` (sub-tenant geographic/command scope)

Persisting a non-admin user without either constitutes a security
incident. Production user-creation paths must enforce this.

### Why mechanical enforcement (model validation) was tried and reverted

A `User#non_admin_must_have_scope` `validate` block was the obvious
structural fix — make the bad state unrepresentable in the database.
It was implemented, tested in isolation, and reverted because it
cascaded through ~280 specs that create non-admin users via factory
without explicit scope (a legacy of the original permissive policy
contract). Updating those specs would have been multi-day work and
would have produced churn in unrelated PRs whenever a contributor
touched a user-related test.

The cost-benefit analysis: the production risk is latent (no current
path triggers it), and updating the test suite *was* the work — the
strict validation is the cheap part.

### Where enforcement WILL live (scheduled)

When the test suite gets a planned cleanup pass to standardise user
factory usage, the `non_admin_must_have_scope` validation should land
alongside it. Until then, this ADR is the authoritative statement of
the contract for code reviewers and operators.

## Consequences

- **Code reviewers** know that any new user-creation path (controller
  action, seed file, background job, migration) MUST set
  organization_id or area_of_operation_id on non-admin user records.
  A PR that creates a non-admin user without scope should be blocked
  in review with this ADR cited.
- **Operators / ops engineers** know that a non-admin user with nil
  scope is a misconfiguration to investigate, not a normal state.
  Any automated user-management tooling (LDAP sync, IdP provisioning,
  CSV import) must enforce the contract before insert.
- **Future contributors** who try to reintroduce a permissive
  default ("just allow nil scope, it makes tests easier") see this
  ADR and the linked review verbatim. The decision is documented.
- **Operational hardening roadmap** carries an explicit item:
  re-attempt the model validation alongside a full user-factory
  audit. Estimated cost: 1-2 days of focused test cleanup.

## What this is NOT

- **Not a structural guarantee.** A misconfigured production migration
  or admin tool can still produce a non-admin user with nil scope. The
  policy layer will then treat them as unrestricted, leaking global
  data. The mitigation is operator/code-review discipline until the
  validation lands.
- **Not a defence against compromised admin accounts.** Admins are
  legitimately unrestricted; this contract does not reduce their
  blast radius. Compromised-admin defence is a separate concern
  (audit logs, session revocation, MFA — see future ADR-010 on
  adversarial threat model).
- **Not a replacement for Pundit policy_scope discipline.** Every
  controller action still needs `policy_scope`/`authorize` calls; the
  scope-restricted predicate is one input the policy layer consumes,
  not the only line of defence.
