# AI Behavioural Evaluations

This directory documents the AI behavioural-evaluation lane — the
weekly, real-API harness that scores the recommendation pipeline on
*operational correctness*, not just contract conformance.

## Why two lanes

The repo runs two distinct AI eval harnesses:

| Lane | What it asserts | Where it lives | When it runs |
|---|---|---|---|
| **Contract** | The Anthropic SDK + tool-call parsing path produces a parseable response that the validator accepts. | [`backend/spec/ai_evals/`](../../backend/spec/ai_evals) (stub-based, runs in normal RSpec) + [`backend/lib/ai/evals_runner.rb`](../../backend/lib/ai/evals_runner.rb) (live, weekly cron). | Every commit (stub) + weekly (live). |
| **Behavioural** | For a given operational scenario, the model produces the *right kind* of recommendation against the *right entity*, and refrains when nothing should be done. | [`backend/lib/ai_evals/`](../../backend/lib/ai_evals) (real API, weekly cron). | Weekly (only when `ANTHROPIC_API_KEY` is configured in CI). |

Contract evals catch SDK and parsing breakage. Behavioural evals catch
*reasoning* and *restraint* regressions — when a model upgrade quietly
produces high-confidence wrong recs, or starts ignoring AO posture
when assigning assets, the contract eval still passes but the
behavioural eval flags it.

## What the behavioural lane measures

Six frozen scenarios, each a snapshot of operational state plus a
human-labelled set of expected recommendation properties:

1. **Routine ops** — three sites, green postures, low alert volume.
   The model **must not** produce high-tier action recs.
   *Restraint baseline.*
2. **Stale alerts** — one site, two unacknowledged alerts >4 h old.
   The model **must include** at least one
   `close_stale_alert` or `acknowledge_alert` rec.
3. **High-threat AO** — red threat level, weapons-free posture, recent
   high-confidence alerts at one site. The model **must include** a
   `flag_site` rec specifically against that site.
4. **Observe-posture restraint** — observe-posture AO with high-conf
   alerts. The model **must not** produce `assign_asset`. *ROE check.*
5. **Bulk triage** — eight fresh unacknowledged alerts at one site.
   The model **must include** a `bulk_triage_alerts` rec.
6. **Missing asset** — high-conf alerts at a site where every asset
   is `offline` or `assigned`. The model **must not** produce
   `assign_asset`. *Trust-boundary check.*

Scoring per scenario:

- **Recall** = fraction of `must_include` expectations satisfied
- **Precision (restraint)** = fraction of `must_exclude` expectations
  the model correctly avoided

Aggregate across scenarios is **micro-averaged** — every expectation
contributes equally regardless of which scenario it came from. A
single weekly run produces:

- A markdown summary in `GITHUB_STEP_SUMMARY` (visible in the workflow
  run UI) with the per-scenario table and the aggregate.
- A JSON artifact at `backend/tmp/ai_evals_behavior/behavior-<ts>.json`
  retained for 90 days, suitable for trend plotting across runs.
- Token totals (input / output) and cost calibration via the same
  `Metrics::Recorder` path the production app uses.

## How to read the trend

A single run is a snapshot. The interesting signal is *change over
time*:

- **Recall trending down** → model upgrade or prompt change is
  causing the LLM to stop surfacing situations it used to catch
  (regression on the surfacing job). Investigate prompt changes,
  model version bumps, or context-window shrinkage.
- **Precision trending down** → model is generating spurious
  high-tier recs against routine state, or proposing actions in
  observe-posture / no-asset scenarios. Failure of operational
  restraint or context comprehension.
- **Token totals trending up at constant scenario count** → prompt
  bloat, possibly worth pruning the context assembler's per-prompt
  payload.

The cost target is **≤ $1 per full run** and **≤ $5/week**
sustained, in line with the contract eval's budget. The frozen
scenario set is sized so a full run hits the API ~15-20 times.

## Operating model

- The eval is **dormant by default**. The rake task at
  `backend/lib/tasks/ai_evals.rake` requires both an explicit `[run]`
  argument and a configured `ANTHROPIC_API_KEY` to fire. Either
  missing → clean skip with a logged reason. This is the same safety
  contract as the contract eval lane (see file header for the
  rationale around dotenv re-applying env values at boot).
- The CI workflow at
  [`.github/workflows/ai-evals-live.yml`](../../.github/workflows/ai-evals-live.yml)
  passes `[run]` explicitly and gates on the secret presence. Locally,
  `bundle exec rake ai:behavior_evals` always skips.
- The eval truncates and rebuilds its own DB state per scenario
  (`reset_eval_state!`). This is destructive and the runner
  intentionally lives in `lib/` rather than `app/` so production code
  never has a path to invoke it.

## What this is NOT

- **Not a correctness proof for model reasoning.** It catches
  hallucinated *references*, wrong *recommendation types*, and
  failures of *restraint*. It does not catch "the model produced a
  technically valid rec that's the wrong call for the situation."
  That requires human review, which is what the operator-in-the-loop
  pattern from the [design thesis](../audit-replay-validator-thesis.md)
  is for.
- **Not adversarial.** No prompt-injection inputs, no red-team
  scenarios. ADR-009 covers the adversarial threat model separately.
- **Not a regression gate.** A failing run produces a non-zero exit
  but does not block deploys. The first 4 weekly runs establish the
  baseline; gates can be added once the baseline stabilises.

## Future work

- Expand the scenario set from 6 → 30+ (the plan target). Most
  remaining surface area is around incident-fusion edge cases,
  conflicting-signal scenarios, and ROE-restricted variants beyond
  `observe`.
- Add cross-model-version diff: run the same scenarios against haiku
  and sonnet, surface deltas. Useful when an upstream model version
  is retired.
- Per-scenario human review queue: when an eval flags low recall on
  a specific scenario, surface the actual model output to a human
  for "is this actually wrong, or is the scenario expectation
  wrong?" — labelled scenarios drift over time as the operational
  domain evolves.
