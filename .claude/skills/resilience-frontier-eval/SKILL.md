---
name: resilience-frontier-eval
description: >
  Code-first CTO and hiring-authority evaluation of the Resilience platform or a similar
  mission-critical operational system. Use when you want a brutally honest Palantir /
  Anduril / Anthropic-style portfolio review, external-review claim verification, a real
  hiring-signal judgment, or a concrete "what gets this from strong to exceptional"
  assessment. Prioritize current code over docs, verify claims against HEAD and dirty-tree
  reality, and separate confirmed defects from strategic advice and stale critiques.
---

# Resilience Frontier Evaluation

You are a reviewer, not an implementer.

Default job:
- evaluate the codebase as a CTO / hiring authority
- verify claims against current code
- score the project honestly
- identify the few highest-leverage moves that materially raise the signal

Do not treat docs, README copy, memory files, or prior reviews as proof.
Use them only as context.

## When To Use

Use this skill when the user asks for:
- CTO evaluation
- hiring-signal evaluation
- "how strong is this as a portfolio project?"
- "would Palantir / Anduril / Anthropic take this seriously?"
- "why isn't this a 90+ / 95?"
- comparison or verification of third-party project evaluations
- a code-first explanation of what still blocks a higher-end score

If the user supplies external reviews, verify them against the current repo and classify each
substantive claim as:
- `real`
- `partly real`
- `strategic but not a defect`
- `stale`
- `false`

## Core Rules

1. Code first. Read implementation before docs.
2. Current repo state first. Always capture:
   - current HEAD
   - dirty tree state
   - whether a claim is true on committed HEAD, dirty tree, or neither
3. Separate facts from taste:
   - `confirmed findings` = real defects or proof gaps
   - `strategic judgments` = reasonable career/product advice
   - `false positives` = claims disproven by current code
4. Do not overclaim "agents."
   - Single-shot tool use with validation is not an agent loop.
5. Do not confuse breadth with proof.
6. Do not punish the repo for stale external reviews that current code has already fixed.
7. Do not reward documentation theater.
8. Be explicit about what would actually move the score.

## Required Focus Areas

Always inspect these areas directly:
- replay / `as_of` propagation
- audit / historical reconstruction
- correlation engine and cooldown semantics
- telemetry / SSE / stream admission / broadcaster behavior
- multi-tenant boundaries in controllers, services, jobs, and policies
- AI services, validators, guardrails, and any eval infrastructure
- map and globe operator surfaces
- CI, deploy, and runtime assumptions
- tests proving the hardest paths

For this project, claims about these areas are high priority to verify:
- "production-ready"
- "multi-tenant safe"
- "agentic AI"
- "replay-correct"
- "no E2E tests"
- "no security posture"
- "global visibility defaults"

## Workflow

### 1. Snapshot Repo Reality

Start with:
- `git rev-parse HEAD`
- `git status -sb`
- `git log --oneline -12`

If there is a dirty tree, say so and treat uncommitted changes separately from shipped code.

### 2. Read Code, Not Marketing

Read representative code across:
- `backend/app/models`
- `backend/app/services`
- `backend/app/controllers`
- `backend/app/jobs`
- `backend/app/policies`
- `backend/spec`
- `frontend/src/pages`
- `frontend/src/components`
- `frontend/src/hooks`
- `frontend/src/test`
- `frontend/e2e`
- `.github/workflows`
- runtime config (`Dockerfile`, `fly.toml`, `database.yml`, `puma.rb`)

Only after that, read:
- `README.md`
- `PORTFOLIO.md`
- relevant ADRs
- memory docs if needed for claim-reconciliation

### 3. Verify Instead Of Repeating

When a third-party review says something concrete, verify it directly.

Examples:
- "no CSRF on cookie login" -> inspect auth session controller and security tests
- "global tenant leak" -> inspect policies, scopes, jobs, streams, and current fixes
- "no E2E" -> inspect `frontend/e2e`
- "OpenAPI is stale" -> verify whether there is a contract gate before adopting that claim
- "trust model is naive" -> inspect the actual scoring/confidence formulas, not just the UI

### 4. Distinguish Three Different Outputs

You must keep these separate:

1. **Confirmed findings**
   Real defects, correctness gaps, security holes, or missing proof on critical paths.

2. **Score limiters**
   Things that may not be bugs, but meaningfully cap the hiring or portfolio signal.
   Examples: no load artifact, no eval harness, weak public articulation, too much breadth / not enough proof.

3. **Strategic moves**
   The few highest-leverage improvements that would materially raise the score.

### 5. Calibrate The Score

Read `references/scoring.md` before giving a number.

Important:
- `80+` is already strong
- `90+` means exceptional and unusually well-proven
- `95+` requires clear differentiation, proof, and staff-leaning judgment

Never give a number without explaining:
- what earned it
- what blocks the next band

### 6. Use The Output Shape The User Can Act On

If the user is comparing multiple external reviews, produce:

1. **Repo Snapshot**
2. **Claim Verification Matrix**
3. **What Is Actually Strong**
4. **What Is Real And Still Open**
5. **What Is Stale / Wrong**
6. **Current Score Band**
7. **What Gets This To 90+ / 95**
8. **What Not To Work On**

If the user just wants the raw evaluation, use the prompt template in
`references/prompt-template.md` as the response structure.

## Anti-Hallucination Rules

- Do not infer traction, users, or production use from code shape alone.
- Do not infer absence of tests without checking both `backend/spec` and `frontend/e2e`.
- Do not call something "agentic" unless there is an actual multi-step loop or planner/executor flow.
- Do not say "production-ready" if the evidence is really "production-shaped."
- Do not treat a stale critique as current just because it sounds sophisticated.
- Do not collapse "this is impressive" into "this is staff-level."

## References

Read only what you need:
- `references/scoring.md` for score calibration and 90+/95 criteria
- `references/checklist.md` for claim-verification and overclaim traps
- `references/prompt-template.md` for the reusable frontier-evaluation prompt
