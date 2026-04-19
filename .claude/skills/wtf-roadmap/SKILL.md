---
name: wtf-roadmap
description: >
  Canonical roadmap-truth review for Resilience milestones and roadmap claims.
when_to_use: >
  Use for wtf-roadmap, roadmap audit, roadmap truth, "does the roadmap match reality",
  "is the roadmap honest", "what is actually built vs claimed", "can we move to the next phase",
  or any request to verify roadmap claims against the real implementation.
disable-model-invocation: true
---

# WTF Roadmap

This skill exists to answer one narrow question:

**Do the roadmap claims match the real implementation?**

It is not a substitute for:
- `resilience-execution` (building the current slice)
- `gate` (pre-commit diff review)
- `audit` (whole-system forensic review)

`wtf-roadmap` is the milestone-truth skill.

## Core standard

Treat the roadmap as a set of claims.
Treat the code as the source of truth.

Do not accept milestone labels, handoff language, README claims, TODO markers, or file names as proof.

Only mark an item complete if the actual product behavior, wiring, contracts, and supporting implementation are present in code.

## What this skill should answer

Use this skill to determine:
- whether the current roadmap is honest
- whether a phase or milestone is actually complete
- whether the repo can truthfully move to the next phase
- which claimed-complete items are really partial, missing, or overstated
- which implemented capabilities are real but undocumented

## What this skill should NOT do

Do not drift into a general audit.

Do not turn this into:
- a production-readiness review
- a security audit
- a scalability audit
- a broad architecture critique
- a generic code-quality review

Those belong to `audit`, unless they directly change roadmap truth.

Example:
- If a feature is claimed complete but breaks replay integrity, that matters here because the claim is false.
- If a subsystem has a theoretical scaling limitation but the roadmap never claimed otherwise, that belongs in `audit`, not here.

## Primary sources of truth

Read the roadmap in this order:

1. `memory/execution_context.md`
2. `memory/execution_handoff.md`
3. any explicitly referenced roadmap file still in active use
4. only then legacy roadmap/history files if needed for context

Treat the execution package as the primary source for current active work.

If legacy roadmap documents conflict with the execution package:
- prefer the execution package for active status
- call out the contradiction explicitly
- do not silently merge them

## Review posture

Operate like a high-bar CTO / principal engineer reviewing milestone truth for a high-stakes operational product.

Be:
- skeptical
- code-first
- conservative
- explicit

Do not flatter.
Do not infer completion from intent.
Do not mark something complete because "most of it is there."

## How to run the review

### Step 1: Read the roadmap claims

Extract the concrete deliverables.

Rewrite vague themes into verifiable items such as:
- page or operator surface exists and is wired
- backend flow exists and is reachable
- replay behavior is actually replay-safe
- map or globe behavior is implemented on the real surface
- AI capability is real, scoped, and integrated where the roadmap claims it is
- tests exist where the roadmap implies production-grade confidence

Do not keep the roadmap at the level of slogans.

### Step 2: Build a verification checklist

Turn the roadmap into a numbered checklist of discrete items.

Each item should be something you can verify from:
- routes
- controllers
- services
- policies
- models
- schema or migrations
- frontend pages/components/hooks
- tests
- config/deploy wiring when relevant

### Step 3: Read the implementation

Inspect the actual code deeply enough to verify the item.

Read:
- the main implementation files
- the supporting dependencies/providers/consumers
- tests that prove or fail to prove the item
- relevant route and wiring files

Do not stop at filenames or component presence.
Check whether the feature is actually live in product terms.

### Step 4: Assign a status

Allowed statuses:
- `COMPLETE`
- `PARTIAL`
- `MISSING`
- `UNCLEAR`
- `FALSE-COMPLETE`

Use `FALSE-COMPLETE` when the roadmap or team state implies "done" but the code does not justify that claim.

Be conservative:
- if key wiring is missing, it is not complete
- if behavior exists only on one surface when the roadmap claim is broader, it is partial
- if logic is mocked, stubbed, or only shell-deep, it is not complete
- if proof is inadequate and code evidence is ambiguous, mark unclear

### Step 5: Judge milestone honesty

After item-by-item verification, answer:
- Is the roadmap honest?
- Is the current milestone actually complete?
- Can the team safely move on?

Do not confuse "valuable progress" with "complete."

## What does NOT count as complete

Do not mark an item complete if it is only:
- a UI shell
- a backend endpoint without real consumer wiring
- a frontend surface with mock or placeholder behavior
- a service that exists but is unreachable from product flows
- an implementation that works only live but not in replay when replay correctness is part of the claim
- a map/globe affordance that exists visually but breaks selection, trust, or route-sync expectations
- an AI surface that exists but is not actually scoped or integrated as claimed
- a tested helper without product wiring

## Evidence standard

Every status judgment must be supported by concrete code evidence.

For each item, provide:
- file references
- the actual implementation evidence
- what is present
- what is missing, if anything

If you cannot support the judgment from code, mark it `UNCLEAR`.

## Output format

Return the review in this structure:

## 1. Audit Approach
Briefly explain which roadmap sources you treated as primary and how you verified the code.

## 2. Roadmap Checklist
Rewrite the roadmap as a numbered list of concrete verifiable items.

## 3. Verification Results
For each item, provide:
- Item
- Status: COMPLETE / PARTIAL / MISSING / UNCLEAR / FALSE-COMPLETE
- Evidence
- Short explanation

## 4. False-Complete Items
List items that are overstated, prematurely treated as done, or contradicted by implementation reality.

## 5. Major Gaps
List the most important missing or partial items that block milestone honesty.

## 6. Can We Move On?
Answer directly:
- YES
- NO

Then explain why in roadmap-truth terms.

## 7. Required Next Actions
List the exact next actions needed before the roadmap can honestly claim completion.

## 8. Brutal Honesty
State plainly:
- what is genuinely complete
- what is weaker than claimed
- what is undocumented but real
- what the roadmap is overclaiming

## Final behavioral rules

- Be code-first
- Be explicit about contradictions
- Be conservative about completion
- Do not import generic audit findings unless they change roadmap truth
- Do not invent missing roadmap items
- Do not hide uncertainty; use `UNCLEAR`

## Final directive

Your only job is to answer:

**Does the roadmap match the implementation, item by item?**

If yes, say so.
If not, identify exactly where reality diverges.
