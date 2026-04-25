# AI Evaluation Harness

Regression + schema-conformance tests for the AI services under
`app/services/ai/` and `app/services/recommendations/`.

## What this harness is

A curated set of **input → Anthropic-response → expected-output**
triples. Each eval pins a known-good behaviour of a specific AI
service so a future change (SDK upgrade, prompt tweak, model
version bump) that silently breaks parsing or validation is caught
before it ships.

The harness is **stub-based** — it does not call real Anthropic.
The Anthropic response is provided as a fixture so the eval is fast,
deterministic, and runs in CI without credit or network access.

## What this harness is NOT

- **Not a live-model regression suite.** Cross-model-version stability
  (haiku 4.5 vs sonnet 4.6 on the same input) requires real API calls
  and live-output diff. That belongs in a separate, credit-costing
  CI lane gated behind a workflow dispatch trigger.
- **Not an adversarial / prompt-injection harness.** That requires
  red-team inputs and measurement of model compliance, which again
  requires real API. See ADR-009 for the adversarial threat model.
- **Not a latency / cost dashboard.** `Metrics::Recorder` already
  records AI call latencies to `OperationalStatus`. Cost tracking
  is a future item (see ADR-008 v2 and the open-scale-work list in
  production-readiness memory).

## How to add an eval

1. Create a fixture under `spec/ai_evals/<service>/<case>.rb` with:
   - `input:` — the user query / parameters the service receives
   - `anthropic_response:` — the stubbed tool_use block(s) the API
     would have returned for this input
   - `expected:` — the normalised service output shape you expect
2. Add an `it` block in the relevant `*_eval_spec.rb` that loads the
   fixture and runs it through the shared harness.

## How to run

```bash
# Run all evals
bundle exec rspec spec/ai_evals/

# Run a specific service's evals
bundle exec rspec spec/ai_evals/filter_evals_spec.rb
```

## What each eval proves

- `filter_evals_spec.rb` — `Ai::FilterService` correctly extracts
  structured filter parameters from tool_use output, including
  input normalisation for the enum-bounded site_id / priority /
  workflow_status fields.
- `ontology_query_evals_spec.rb` — `Ai::OntologyQueryService`
  correctly extracts root entity + relations + time window from
  the tool_use output and rejects unsupported root types.
- `validator_evals_spec.rb` — `Recommendations::Validator`
  correctly applies the four-check trust boundary from ADR-005 on
  realistic LLM outputs (hallucinated IDs, type/entity mismatches,
  valid payloads).

The harness is intentionally small (one golden per service
subsystem). The goal is a clear regression surface, not
exhaustive coverage — exhaustive belongs in the existing unit
specs under `spec/services/ai/`.
