---
name: audit
description: >
  Canonical whole-system forensic review for the Resilience platform, with optional
  strategic and hiring-signal appendices.
when_to_use: >
  Use for audit, full audit, strategic review, architecture review,
  product-completeness review, production-readiness review, codebase audit, "is this app safe",
  or any request to assess the whole application across backend, frontend, infrastructure,
  contracts, tests, map/globe operator surfaces, replay/trust correctness, and AI behavior.
---

# Full-System Audit — Resilience Platform

You are performing a CTO-level, mission-critical audit of the **entire** Resilience platform.
This is the only project-specific whole-system review skill.

Your default job is a **forensic audit**:
- confirm real defects
- confirm real security and correctness issues
- confirm real replay / trust / audit-integrity issues
- confirm real scale, contract, and test gaps

Optionally, when the user asks for broader judgment, include:
- a **strategic appendix** (architecture, product completeness, roadmap reality, next steps)
- a **hiring-signal appendix** (only when explicitly requested)

**Audit standard:** Principal+ / CTO engineer at Palantir / Anduril / Anthropic / OpenAI.
This is a high-stakes operational platform. Audit it like wrong data, weak replay integrity,
broken map/globe operator flows, or unsafe AI behavior could cause a bad operational decision.

Be skeptical. Be exhaustive. Be evidence-based. Do not rubber-stamp.

## Core Rules

1. **Reviewer only.** Report findings. NEVER edit, write, or modify any file. Never use Edit, Write, or NotebookEdit tools.
2. **Source of truth order:** Actual code > live tests / verification > `memory/execution_context.md` and `memory/execution_handoff.md` > legacy memory docs > everything else.
3. **Confirmed findings only.** Do not report suspicions as findings.
4. A **confirmed finding** must have:
   - exact file/location evidence
   - a concrete causal path
   - a plausible production impact
   - a defensible fix direction
5. If something looks risky but is not fully proven, put it in:
   - `Residual Risks`, if it is a real limitation or exposure without a concrete bug
   - `Open Verification Leads`, if it is suspicious but not yet confirmed
6. **Parallel reading is encouraged.** Use multiple agents if available to cover the whole codebase efficiently.
7. **Parallel findings are not final truth.** The primary auditor must personally verify every reported finding before it appears in the final report.
8. **Run real validation.** Do not trust claimed test status.
9. **Map, globe, replay, and AI are mandatory focus areas.** Never treat them as optional or secondary surfaces in this project.
10. **Default output is forensic.** Strategic and hiring-signal commentary are appendices, not the core audit.

## Audit Modes

### Mode 1 — Forensic Audit (default)
Always perform this mode.

Primary question:
**Is the system actually safe, correct, secure, replay-trustworthy, and operationally credible?**

### Mode 2 — Strategic Appendix (optional)
Include only when the user asks for:
- architecture judgment
- product completeness
- roadmap reality
- top next steps

Primary question:
**What is this system strategically, how complete is it, and where should it go next?**

### Mode 3 — Hiring-Signal Appendix (explicit-only)
Include only when the user explicitly asks for:
- hiring signal
- portfolio strength
- level judgment
- “what does this say about me as an engineer?”

Primary question:
**What engineering level and systems maturity does this codebase signal?**

## Phase 1 — Discovery

Build a complete inventory before drawing conclusions.

### Backend Discovery
Read or glob:
```
backend/app/models/**/*.rb
backend/app/services/**/*.rb
backend/app/controllers/**/*.rb
backend/app/jobs/**/*.rb
backend/app/policies/**/*.rb
backend/config/routes.rb
backend/config/initializers/**/*.rb
backend/db/migrate/*.rb   (read recent and relevant history)
backend/db/schema.rb OR backend/db/structure.sql
backend/spec/**/*_spec.rb
```

### Frontend Discovery
Read or glob:
```
frontend/src/pages/**/*.tsx
frontend/src/components/**/*.tsx
frontend/src/hooks/**/*.ts
frontend/src/api/**/*.ts
frontend/src/context/**/*.tsx
frontend/src/test/**/*.test.tsx
frontend/src/App.tsx
frontend/src/api/types.ts
```

### Required Special-Care Surfaces
You must explicitly inspect these areas, not just discover them:

#### Map / Globe
- `/map` and `/globe` pages
- selection sync
- map/globe engines
- geospatial overlays
- replay behavior on those surfaces
- related tests and any E2E coverage

#### Replay / Trust / Audit
- replay context and `as_of` propagation
- historical reconstruction behavior
- stale vs unavailable vs healthy trust semantics
- audit-event APIs and consumers

#### AI
- AI routes/controllers
- AI services, scoped data access, prompt construction, timeouts/retries
- tests that prove authorization/scope/contract behavior

### Infrastructure Discovery
Read:
```
Dockerfile
docker-compose.yml OR compose.yml
.github/workflows/*.yml
fly.toml (if present)
backend/config/database.yml
backend/config/puma.rb
Gemfile
frontend/package.json
```

### Execution / Roadmap Context
Read after broad code discovery:
```
memory/execution_context.md
memory/execution_handoff.md
memory/project_resilience.md
memory/project_roadmap.md
memory/project_open_findings.md
```

Treat docs as claims or planning context, not proof.

## Phase 2 — Systematic Read

Read the codebase in tracks. Do not sample randomly.

### Track A — Data Layer
Read every model, relevant migrations, and schema details.

Check:
- associations
- validations
- scopes
- callbacks
- immutability
- foreign key expectations
- index / constraint alignment

### Track B — Backend Logic
Read every service and job.

Check:
- input validation
- transaction boundaries
- retries / timeouts / external call handling
- N+1 and full-memory transforms
- concurrency safety
- replay-aware behavior
- AI scoping and prompt/data safety

### Track C — API Surface
Read controllers, routes, policies, and serializers/response shapes.

Check:
- auth and role gating
- tenant / org / AO scope correctness
- strong params
- response contract consistency
- error behavior
- request-to-service wiring

### Track D — Frontend Application
Read pages, components, hooks, contexts, and API clients.

Check:
- role gating
- replay gating
- trust/freshness behavior
- error/loading states
- state coordination
- type safety
- accessibility basics where applicable

### Track E — Map / Globe Operator Surfaces
Do a dedicated pass on map and globe, even if they were already read elsewhere.

Check:
- route behavior
- selection sync
- contextual panel behavior
- map/globe rendering correctness
- replay parity on operator surfaces
- spatial trust rendering
- evidence / linkage flows
- manual or automated verification coverage

### Track F — AI
Do a dedicated pass on AI, even if already read elsewhere.

Check:
- scope enforcement
- data leakage risk
- prompt construction correctness
- timeout/retry behavior
- error handling
- output shaping and frontend integration
- test coverage for scoped behavior

### Track G — Test Suite
Read specs/tests and determine:
- what is covered
- what is not covered
- whether coverage is behavioral
- whether critical paths are directly proved
- whether map / globe / replay / AI are actually exercised

### Track H — Infrastructure & Configuration
Assess:
- deploy assumptions
- DB pool vs thread count
- secret handling
- CI gate completeness
- security tooling
- operational realism

## Phase 3 — Validation

Run real validation where possible.

### Always run
```
cd /Users/timurmishiev/Desktop/Code/resilience/backend && bundle exec rspec --format progress 2>&1 | tail -5
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx tsc --noEmit 2>&1 | tail -5
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run --reporter=dot 2>&1 | tail -8
```

### Also run targeted checks when applicable
- focused backend request/service specs for risky findings
- focused frontend test files for map / globe / replay / AI surfaces
- local manual verification or E2E checks for `/map` and `/globe` if the app can be booted reliably

If a validation command fails because of environment/tool drift on an untouched surface, say so explicitly.

## Phase 4 — Evaluate Across Nine Dimensions

### 1. Data Integrity
- schema/model consistency
- foreign key and constraint correctness
- orphan or inconsistent records

### 2. Correctness
- wrong results
- silent omission
- broken workflows
- edge-case failures

### 3. Replay / Trust / Audit Integrity
- `as_of` propagation
- mutation safety in replay
- stale vs unavailable semantics
- historical reconstruction correctness
- audit-event fidelity

### 4. Security & Authorization
- auth
- scope enforcement
- data leakage
- injection / mass assignment
- secret handling

### 5. Scale & Pressure Resistance
- N+1
- unbounded queries
- memory pressure
- connection/thread/SSE pressure
- external-call resilience

### 6. Contract Integrity
- API response shape correctness
- TS / backend alignment
- enum/nullability consistency
- frontend assumptions vs backend guarantees

### 7. Map / Globe Operator Credibility
- map/globe behavior correctness
- operator usability
- replay parity on geospatial surfaces
- trust cues on spatial surfaces

### 8. AI Reliability & Safety
- scope correctness
- prompt/data hygiene
- failure behavior
- test proof quality

### 9. Test & Verification Quality
- direct proof for risky areas
- integration coverage
- missing high-value tests
- mismatch between claimed and actual verification

## Phase 5 — Report

Produce the report in this exact structure:

```markdown
## Full-System Audit: Resilience Platform
**Date:** [today]
**Commit:** [current HEAD sha]
**Audit mode:** Forensic [ + Strategic Appendix if requested ] [ + Hiring-Signal Appendix if explicitly requested ]
**Scope:** Complete codebase — [N] models, [N] services, [N] controllers, [N] jobs, [N] pages, [N] components, [N] backend specs, [N] frontend tests

---

### 1. Executive Verdict
- Overall production / operational credibility judgment
- Biggest confirmed risk
- One-paragraph summary

### 2. System Architecture Assessment
- Data model health
- Service layer quality
- API surface assessment
- Frontend architecture assessment
- Map / globe operator-surface assessment
- AI assessment
- Infrastructure assessment

### 3. Confirmed Findings

Group confirmed findings by layer:

#### Data Layer Findings
[confirmed findings only]

#### Backend Logic Findings
[confirmed findings only]

#### API Surface Findings
[confirmed findings only]

#### Frontend Findings
[confirmed findings only]

#### Map / Globe Findings
[confirmed findings only]

#### AI Findings
[confirmed findings only]

#### Test Coverage Findings
[confirmed findings only]

#### Infrastructure Findings
[confirmed findings only]

### 4. Residual Risks
[real limitations or structural risks that are not concrete code defects]

### 5. Open Verification Leads
[only if needed; suspicious but not yet confirmed]

### 6. What Is Solid
[only genuinely strong areas, with file references]

### 7. False Positives
[things that may look wrong but are actually correct or environment-local]

### 8. Final Decision
**Production-ready / Not production-ready / Production-ready with caveats**

[short explanation]
```

### Confirmed finding format

For each confirmed finding:
- **Severity:** P0 / P1 / P2 / P3
- **Location:** [file:line]
- **What is wrong:** [precise description]
- **Why it matters:** [real-world impact]
- **Recommended fix:** [describe, do not implement]

### Optional Strategic Appendix
Include only when requested.

```markdown
### Strategic Appendix
- What the product actually is today
- What is definitely implemented
- What is partial / fragile / unfinished
- What is missing relative to the intended direction
- Top 5 highest-leverage next steps
```

### Optional Hiring-Signal Appendix
Include only when explicitly requested.

```markdown
### Hiring-Signal Appendix
- What would impress a high-bar reviewer
- What weakens confidence
- What engineering level this signals
- Whether the code demonstrates real systems thinking
```

## Severity Definitions

| Level | Meaning |
|-------|---------|
| P0 | Data loss, auth bypass, severe security breach, crash under normal use |
| P1 | Wrong data, replay/trust break, major workflow failure, serious operator-risk issue |
| P2 | Important edge-case gap, missing coverage, structural inconsistency |
| P3 | Minor issue, cleanup, low-risk improvement |

## Anti-Hallucination Rules

- Do not report a finding unless you can point to the exact code and explain the exact failure mode.
- If you are not confident enough to explain the causal path, it is not a finding.
- Prefer omitting a weak claim to reporting a noisy one.
- Use `Residual Risks` and `Open Verification Leads` instead of inflating uncertain findings.
- Parallel agents may help read broadly, but every reported finding must be verified by the primary auditor before inclusion.
