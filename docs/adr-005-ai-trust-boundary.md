# ADR-005: AI Trust Boundary — Validator Pattern + Circuit Breaker

**Status:** Accepted
**Date:** 2026-04-23

## Context

Resilience uses Anthropic's Claude via tool-use for three surfaces:

1. **AI briefing** — natural-language operational summary grounded in
   recent audit events, nearby signals, and rule fires for a given
   site or organization.
2. **Ontology query** — commander-only graph traversal that translates
   an entity + relation focus into a bounded walk of the operational
   graph.
3. **Recommendations** — LLM-generated action suggestions with
   evidence chains pointing at real entities (incidents, tasks, sites,
   alerts).

The third surface is the one that creates acute trust risk. A
recommendation has a *display* side (what the operator sees in the UI:
"Escalate Incident INC-001") and a *payload* side (what executes when
the operator accepts: `{ incident_id: "abc-123", action: "escalate" }`).
If the model hallucinates or confuses IDs, the operator could:

- See an incident that doesn't exist (hallucinated display)
- Accept a recommendation that mutates a **different** entity than the
  one they thought they were accepting (display/payload divergence) —
  by far the most dangerous class

This is a correctness problem, not a UX problem. Traditional LLM
guardrails (toxicity, jailbreak resistance) don't address it because
the model isn't being adversarial — it's being imprecise.

Two axes of mitigation must be chosen.

### Axis 1: When to validate

- **Trust + display (rejected):** Show the LLM output and rely on the
  operator to notice if something is wrong. Operators will not catch
  ID-level drift in a dense UI, especially under time pressure.
- **Post-hoc validation at read time (rejected):** Query the DB only
  when the operator clicks "accept." Creates a window where wrong
  recommendations are visible and actionable-looking.
- **Pre-persistence validation (accepted):** The recommendation is
  never saved unless its IDs resolve to real, reachable entities.

### Axis 2: How to recover from LLM-layer failures

- **Retry on every failure (rejected):** Repeated timeouts against
  Anthropic during an outage would amplify load and generate cascading
  requests.
- **Circuit breaker (accepted):** Bounded failure count before opening;
  explicit open window; half-open probe.

## Decisions

### Decision 1: Four validation checks, all pre-persistence

`Recommendations::Validator` runs four checks on every LLM-produced
recommendation before it is saved:

1. **Surfaced entity exists.** The entity whose ID appears in the
   operator-visible part of the recommendation must resolve to a
   live database record.
2. **Each evidence item exists.** Every entity cited in the evidence
   chain must resolve.
3. **Action-payload IDs exist.** Every ID in the executable payload
   must resolve.
4. **Payload IDs refer to the same entity as the surfaced entity.**
   The check that matters most: the `incident_id` in the payload must
   equal the incident the recommendation is displayed against. This
   prevents the "shown as Incident A, acts on Incident B" failure
   mode that is otherwise undetectable at the UI layer.

If any check fails, the recommendation is discarded — the validator
never lets invalid output reach the `recommendations` table, and the
operator never sees it.

### Decision 2: Circuit breaker per AI service

All Anthropic-backed services share a circuit-breaker pattern:

- **3-failure threshold** before opening. Normal request flow until
  three consecutive failures.
- **2-minute open window.** All requests short-circuit during this
  period. No Anthropic traffic, no operator-visible errors beyond
  "AI temporarily unavailable."
- **Half-open probe.** After the open window, one request is allowed
  through to test the upstream. Success closes the breaker; failure
  re-opens for another 2 minutes.
- **Per-service tracking.** The briefing service's breaker is
  independent from the recommendations service's breaker — one can
  be degraded without affecting the others.

Storage: Rails cache (works with `:memory_store` in dev, any
distributed store in prod — Redis, Memcached, Solid Cache).

### Decision 3: Scope isolation for AI queries

The `ScopedRelations` module ensures AI-backed queries respect the
same Pundit scopes as the REST API. There is no privilege escalation
path where the operator asks the AI a question and gets data they
couldn't have read through `/api/sites`. The AI sees the operator's
view of the data, not a superuser view.

## Consequences

- **Hallucinated recommendations never ship.** The four-check
  validator is the structural guarantee. If the LLM invents an
  entity ID, check 1/2/3 rejects the recommendation. If the LLM
  swaps IDs between display and payload, check 4 rejects it.

- **Operators experience LLM failures as degradation, not as noise.**
  Circuit-breaker-open means "AI features temporarily unavailable"
  UX. The rest of the system continues to function. There's no
  retry storm visible to the operator or billed to Anthropic.

- **AI output is treated as untrusted input.** Same architectural
  category as user input. This is the right posture — not because
  the model is adversarial, but because it's probabilistic and
  therefore cannot be trusted to produce referentially-valid output
  100% of the time.

- **New AI surfaces follow the same pattern.** Adding a fourth
  AI-backed service means: route through the circuit breaker,
  validate any entity references against real records before
  surfacing. The trust-boundary discipline is the reusable contract.

- **Testability.** The validator has unit specs for each of the four
  checks, including the cross-reference check (4). The circuit
  breaker has specs that simulate consecutive failures and verify
  the open/half-open/closed transitions.

## What this is NOT

- **Not a guard against prompt injection.** The trust boundary is
  about the model producing invalid references, not about adversarial
  users tricking the model. Prompt-injection defense is a separate
  concern (and largely a product of scope isolation — the AI has no
  access to data the operator couldn't already see).

- **Not a replacement for operator judgment.** Validated ≠ good
  recommendation. The operator still accepts or rejects each one.
  The validator guarantees only that if the operator accepts, the
  action will execute against the entity they think they accepted.

- **Not a correctness proof for the model's reasoning.** The validator
  checks *references*, not *conclusions*. The model might still
  recommend the wrong action for a situation — that's a model-quality
  question, not a trust-boundary question.
