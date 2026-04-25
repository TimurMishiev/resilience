# ADR-009: Adversarial Threat Model

**Status:** Accepted (threat model documented; item 1 of mitigation roadmap shipped via ADR-010; remaining mitigations partial; enterprise-identity gaps explicit)
**Date:** 2026-04-25

## Context

Resilience is positioned as operational intelligence software for
defence-tech scenarios. All three post-production CTO reviews flagged
the absence of a documented adversarial threat model as the single
biggest gap for that positioning. Real defence-tech reviewers (Palantir,
Anduril, Shield AI) specifically test for:

- *"If an adversary has a compromised account, what can they exfiltrate
  before detection?"*
- *"Provenance and chain-of-custody."*
- *"Data classification / compartmentalization."*
- *"Degraded / offline operation."*
- *"Determinism for forensics."*

This ADR enumerates the threat actors, their capabilities, the attack
surfaces they reach in this system, the mitigations currently in
place, and the explicit gaps. It is not a penetration-test report;
it is the design-intent document that a code reviewer or acquirer
should read before asking "what happens when X goes wrong?"

## Threat actors

### 1. Compromised legitimate user (insider threat)

**Capability.** Has valid credentials for a real user account —
session cookie, JWT, or direct password. Could be:
- An exfiltrating employee
- A phished operator whose credentials were stolen
- A contractor with legitimate temporary access

**What they can do today (this is the actual risk posture):**

- Read every record within their tenant scope (policy-layer gate is
  strict for scoped users — see ADR-006, caveat about the unscoped
  non-admin footgun).
- Perform every mutation their role allows: commander role can flag
  sites, transition incidents, acknowledge alerts, generate
  recommendations.
- Download the full operational picture via the API (no rate limit
  on data-read, only on rate-of-requests).
- Trigger AI-backed services at rate-limit budget (10 req/min per
  user, 60 req/hr per user — would be expensive to exfiltrate
  large-volume prose this way).

**What detects them today:**

- Every mutation writes an AuditEvent with actor attribution
  (app/services/audit/event_writer.rb). An operator with query
  access to audit_events can reconstruct the full action log of a
  compromised account.
- Session fingerprinting via UserSession: each session records
  last_seen_at, IP address, user agent. A new IP/UA combination for
  a normally-consistent user would be anomaly-visible but is not
  alerted on automatically.
- Global revocation via `tokens_valid_after` on User records: an
  admin can issue one write that invalidates every existing JWT for
  that user.

**What is missing:**

- No automatic anomaly detection on access patterns (geography,
  velocity, off-hours, mass-read).
- No honeytoken / canary strategy.
- No retention limit on audit_events — but the chain-of-custody
  hash chain (ADR-010) closes the "compromised admin can edit the
  log" path: the DB-level immutability triggers raise on UPDATE /
  DELETE, and any tampering that drops the triggers and rewrites
  rows is detected by the daily Audit::VerifyAllChainsJob.

### 2. External attacker (no credentials)

**Capability.** Reaches the public-facing API endpoints over the
internet. Has no valid credentials; attacks must succeed without
authentication or must compromise the auth layer first.

**Attack surfaces and current mitigations:**

| Surface | Attack | Mitigation |
|---|---|---|
| `/api/auth/login` | Brute-force credential stuffing | `Rack::Attack` per-IP (5/min, 20/hr) + per-email throttle (3/min, 10/hr) — commit c842390. Bcrypt hashed passwords. |
| Cross-origin login-CSRF | Force victim browser to log in as attacker | `Rack::Cors` origin allowlist (middleware) + controller-layer Origin allowlist on `/api/auth/login` (commit c86727a) + `SameSite=Lax` session cookie. Triple-redundant. |
| `/api/ai/*` | Burn Anthropic credit via unauthenticated calls | `require_commander!` before_action plus Pundit authorize — no unauthenticated access. |
| API endpoints at large | SQL injection, mass assignment, XSS | Brakeman passes with zero warnings. Strong params on every controller. Response is JSON only — no template rendering, no XSS surface. `CSP default-src 'none'` on every response. |
| SSE streams | DoS via reconnect storm | Admission control via `SseStreamLease` (advisory locks + per-user/per-IP caps). Thread-per-connection ceiling documented in ADR-002. |
| External feed injection | Malicious data in a feed payload | ~~GAP~~ **CLOSED 2026-04-25 in Tranche 3A**: `Feeds::PayloadGuards` adds a 25 MB body cap, 32-deep JSON nesting cap, UTF-8 validation, and BOM stripping across all 7 feeds. See ADR-007 for the (now-shipped) hostile-data posture; spoofed-but-well-formed AIS / ADS-B signals are still a separate concern (covered by ADR-008's source reliability priors, not the input guards). |

### 3. Nation-state / targeted adversary

**Capability.** Can spoof upstream feeds (AIS broadcasts, ADS-B
transmissions), compromise infrastructure at Fly's layer, apply
sustained credential-stuffing pressure, or exploit zero-days in the
stack.

**What this threat actor gets today:**

- Spoofed AIS signals flow through with source "ais_hub" and
  reliability 0.85 (per ADR-008 source priors). This is a real
  operational risk in contested maritime domains — current product
  does not defend.
- Spoofed ADS-B flows through with source "opensky" and reliability
  0.90. Same issue.
- Fly infrastructure compromise (Fly-root access, machine takeover)
  would give the adversary all the data at rest — no separate
  encryption-at-rest layer beyond whatever Fly Postgres provides.
- Zero-days in Ruby, Rails, Postgres, or Cesium are out of scope —
  mitigated only by CI security scanning (Brakeman + bundler-audit +
  yarn audit on every push).

## Current mitigations — summary of what exists

- **Authentication**: JWT with per-JTI revocation, per-user global
  `tokens_valid_after`, session inventory + revoke endpoints.
- **Authorization**: Pundit on every controller action,
  `verify_authorized` after-action as deploy-time gate, 30 named
  policies, org + AO scope dimensions.
- **Rate limiting**: `Rack::Attack` with per-IP and per-user/per-email
  throttles on login and AI endpoints. In-memory store (single-
  machine only).
- **Input sanitisation**: Rails strong params; no raw SQL outside
  parameterised queries; Brakeman zero warnings.
- **Output safety**: JSON API only, `CSP default-src 'none'`, HSTS
  in production.
- **Supply-chain hygiene**: bundler-audit + yarn audit gates on every
  PR; Dependabot for weekly updates.
- **Audit trail**: Every mutation flows through `EventWriter` in
  the same transaction as the mutation. Append-only at the DB level
  via `prevent_audit_event_update` / `prevent_audit_event_delete`
  triggers, plus a per-organization SHA-256 hash chain that detects
  tampering even if the triggers are dropped (ADR-010). Daily
  `Audit::VerifyAllChainsJob` walks every chain and reports breaks
  via `OperationalStatus("job_health", "audit_chain_integrity")`.
- **Circuit breaker for external services**: AI services have per-
  service circuit breakers (3-failure / 2-minute window / auto-
  reset) so an Anthropic outage does not cascade.

## Explicit gaps — the honest list

These are the items a defence-tech acquirer would specifically test
for and find missing:

1. **Enterprise identity — partial.** **TOTP MFA shipped 2026-04-25
   in Tranche 3B**: per-user TOTP secret (encrypted via
   `Mfa::SecretCipher` over the secret_key_base root of trust),
   provisioning URI for any RFC 6238 authenticator app, 10
   single-use BCrypt-hashed recovery codes per user, replay
   protection via `totp_last_used_at` + ROTP's `after:` parameter.
   Login flow: password-only returns 401 with
   `{ mfa_required: true }`; reissue with `totp_code` or
   `recovery_code` to complete. Disable requires re-proof.
   **Still open**: SSO / OIDC / SAML integration, SCIM
   provisioning, WebAuthn (deferred to a follow-up tranche per
   the locked plan), forced-MFA-by-role policy.
2. **No data classification / compartmentalization.** Multi-tenancy is
   organization + AO; no "this user can see this tenant's data but
   only the SECRET-level subset." No per-record sensitivity labels.
3. **Chain-of-custody / tamper-evident audit log.** **CLOSED** in
   ADR-010 (shipped 2026-04-25). Every `audit_events` row carries a
   per-org SHA-256 chain (`row_hash` over a canonical payload,
   `prev_hash` linking to the previous row's `row_hash`). DB-level
   triggers refuse UPDATE / DELETE. `Audit::ChainVerifier` walks the
   chain end-to-end and reports the exact `chain_position` of any
   tampering. Daily scheduled sweep + admin-only on-demand endpoint.
   Out of scope: external attestation (committing the chain tip to a
   third-party time-stamping service or SIEM) — noted as future
   hardening in ADR-010.
4. **No anomaly detection on access patterns.** Velocity, geography,
   off-hours, mass-read volume — none are automatically monitored
   or alerted.
5. **No honeytoken strategy.** No seeded fake records that would
   fire an alert if accessed.
6. **No air-gap / disconnected operation.** Live AI features require
   internet to Anthropic. Map tiles are hosted externally. Whole
   product assumes connectivity.
7. **Adversarial-input posture on feeds — partial.** Malformed
   feed payloads (oversized body, deeply nested JSON, invalid
   UTF-8) **CLOSED 2026-04-25 in Tranche 3A** via
   `Feeds::PayloadGuards` — see ADR-007 item 4. Spoofed-but-
   well-formed AIS / ADS-B signals still flow through at their
   nominal source reliability — that's a separate concern handled
   by ADR-008's source-reliability priors, not the input guards.
8. **No forensic-determinism contract.** Replay uses `DISTINCT ON`
   with `(occurred_at, sequence)` tie-breaking (see ADR-001 plus
   the sequence-column commit `4bb9d36`). The contract works today,
   but has no formal correctness proof — a migration that reorders
   sequence generation would silently break determinism.

## Mitigation roadmap — ranked by leverage per effort

Items that would close defence-tech-specific gaps, ranked by
cost-benefit:

| Priority | Item | Effort | Why |
|---|---|---|---|
| 1 | ~~Chain-of-custody on audit_events~~ **SHIPPED 2026-04-25** | 2-3 days | See ADR-010. Per-org SHA-256 hash chain + DB-level immutability triggers + verifier service + admin endpoint + scheduled daily sweep. |
| 2 | Anomaly detection on access patterns | 3-5 days | Background job computes rolling access velocity / off-hours multipliers per user; alerts when a user's pattern deviates. Requires a `user_access_profile` table. |
| 3 | ~~Feed connector hostile-input guards~~ **SHIPPED 2026-04-25** | 1-2 days | See ADR-007 item 4 + `Feeds::PayloadGuards`. 25 MB body cap, 32-deep JSON nesting cap, UTF-8 + BOM normalisation across all 7 feeds. |
| 4 | ~~MFA (TOTP)~~ **TOTP SHIPPED 2026-04-25** / WebAuthn deferred | 2-3 days | TOTP shipped via `rotp` gem + `Mfa::EnrollmentService` + login-flow integration + 10 BCrypt-hashed recovery codes per user + replay protection via `totp_last_used_at`. WebAuthn deferred to a follow-up tranche; pilot blocker for the TOTP requirement is resolved. |
| 5 | SCIM provisioning endpoint | 3-5 days | Enterprise-IdP integration. Deferred until a real customer conversation justifies the shape. |
| 6 | Per-record classification labels | 5+ days | Requires a product conversation about classification scheme. Don't build until an operator tells us what schema they need. |
| 7 | Honeytoken strategy | 1 day | Low effort, high signal. Seed a known-fake site / incident; fire an alert if any user reads it. |
| 8 | Air-gap / offline AI | multi-week | Requires a local model deployment story. Out of scope for the current portfolio posture. |

## Consequences

- **Code reviewers** know which threats are modelled and which are
  explicit gaps. A PR that touches the audit log, the auth layer,
  or the policy layer should reference this ADR in its description.
- **Defence-tech acquirers** reading this ADR see honest scoping —
  not "we're secure," but "here's what we defend against, here's
  what we don't, and here's our opinion on the priority order."
  That posture is itself the signal; the naive alternative is to
  claim everything is covered and be caught.
- **Operational hardening roadmap** carries items 1-4 explicitly.
  The rest are product-conversation-gated.

## What this is NOT

- **Not a penetration-test report.** This is design intent, not
  empirical test results. A real red-team exercise would find
  issues this document does not enumerate.
- **Not a compliance checklist.** NIST 800-53, FedRAMP, DoD
  RMF, and equivalent are explicit out-of-scope for a portfolio
  project. A real defence-tech product would map this threat
  model to those frameworks.
- **Not a cryptographic proof of replay determinism.** ADR-001
  asserts the `DISTINCT ON (entity_id) ORDER BY (occurred_at,
  sequence) DESC` contract holds under concurrent writes (sequence
  added in commit 4bb9d36), but we have not proven it against an
  adversarial clock-skew or compromised-sequence-generator scenario.
- **Not a guarantee about Anthropic model behaviour.** The AI
  trust boundary (ADR-005) catches structural errors in model
  output. It does not defend against a compromised model returning
  plausible-looking but incorrect operational advice; no trust
  model at the service boundary can close that gap without a
  feedback loop (see ADR-008 v2).
