---
name: slice_plan_explainer
description: Planning artifact for the selection-grounded AI explainer slice on map/globe — UX, backend decision, grounding contract, test surface, rollout
type: project
---

# Slice Plan: Selection-Grounded AI Explainer (map / globe)

**Drafted:** 2026-04-29 (post-hardening rotation close)
**HEAD at draft:** `a57f5c6` on `main` — production at `95a3532`
**Status:** PLANNING ONLY — implementation does not begin until the
gating uncertainty (Anthropic credit) is resolved tomorrow.

---

## 1. The slice in one paragraph

Operator selects a site / incident / signal on `/map` or `/globe`. The
existing inspector panel gains an **`Explain`** button. Clicking it
produces a short, replay-aware AI summary covering: what this entity
is, why it matters, what changed recently, what the likely next
operator action is. The summary is grounded by the current `as_of`
(if replaying) and the current selection only — no global context
bleed. Citations to AuditEvent UUIDs render inline. The panel shows
loading / error states identically to the existing Briefing Page so
the pattern is familiar.

This slice deliberately reuses four already-strong systems:
- **AI summary infrastructure** (`Ai::SummaryService`,
  `Ai::AnthropicClient`, `Ai::PromptSafety`, `Ai::CircuitBreaker`)
- **Selection sync** (URL ↔ state ↔ inspector pattern, proven on
  both surfaces)
- **Replay-aware fetching** (`as_of` propagation already wired in
  every relevant hook)
- **Audit citation contract** (citation validation against sent
  AuditEvent IDs only, anti-hallucination guard already proven in
  Briefing)

It introduces one new component, one new `summary_type`, and zero
new infrastructure.

---

## 2. UX shape

### Where it lives
- `/map` inspector panels (site / signal / asset variants)
- `/globe` inspector panels (same three variants)

### Trigger
- Single button labeled `Explain` in the inspector header
- Hidden when no entity is selected
- Hidden during pending/loading states of the underlying entity fetch
- Disabled (not hidden) for viewer role with tooltip "Commander+ only"
  — matches existing AI gating pattern

### Active state (on click)
1. Button transitions to spinner + "Generating…"
2. Inspector body renders a new section: **Explanation**
3. While generating: skeleton / Spinner with grey-text placeholder
4. On success: structured prose + "Citations: [audit_event_id_1, …]"
   (rendered as expandable refs that link to the audit timeline at
   that occurred_at)
5. On failure: Blueprint `Callout` with intent="danger" + the
   user-facing error string (already sanitized — server-side log
   captures the diagnostic)

### Replay behavior
- If `isReplaying` is true: explanation is grounded to that `as_of`
  and is read-only (no regenerate button)
- If live: regenerate button is available, throttled to once per 30s
  per entity (frontend-side debounce; backend rate limit at
  `rack_attack.rb` 5/min/user already covers the abuse case)

### Empty / degraded states
- Anthropic credit exhausted / circuit breaker open: button stays
  visible but disabled with tooltip "AI explainer temporarily
  unavailable" (matches existing Briefing degradation)
- Selection has no audit history: button still works but explanation
  notes "no recent state changes" — proves the grounding works
  honestly rather than hallucinating events
- Network failure mid-generate: error state, button re-enables for
  retry

---

## 3. Backend: extend `Ai::SummaryService`, do not create new service

### Decision
Extend [summary_service.rb](backend/app/services/ai/summary_service.rb)
with a new `summary_type` value: `entity_explainer`.

### Why extend, not new service
- 80% of the wiring (Anthropic client, circuit breaker, scoping,
  prompt sanitization, citation validation, replay propagation,
  cost telemetry, error envelope) is already in place
- The differences are **only** in: scope query (single entity
  vs. site-wide), prompt template, output shape (4 sections vs.
  briefing prose)
- A new service would duplicate ~200 lines of plumbing for ~50
  lines of unique logic — wrong leverage
- `ALLOWED_SUMMARY_TYPES` array makes the extension trivial and
  the existing test suite for SummaryService stays load-bearing
- `Ai::PromptSafety` already wired in this service; we get the
  audit-P3 hardening for free

### What changes in `SummaryService`
- Add `entity_explainer` to `ALLOWED_SUMMARY_TYPES` constant
- New initializer signature accepts:
  - `entity_type:` (one of: `Site`, `SignalRuleMatch`, `ExternalSignal`)
  - `entity_id:` (UUID)
  - existing `as_of:` and `user:` parameters
- New private method `fetch_entity_context` that:
  - Validates entity is in `policy_scope` for the user
  - Loads entity + its associated audit events filtered by `as_of`
  - Loads recent rule fires referencing this entity (last 72h or
    pre-`as_of` window)
  - Returns the same shape `fetch_events` / `fetch_signals` /
    `fetch_matches` return today, just narrowed to entity scope
- `build_system_prompt` extended with `entity_explainer` branch:
  short prompt, 4-section output structure, JSON shape with
  `summary` (array of 4 strings: identity, significance, recent
  changes, next action) + `citations` (subset of supplied audit
  event IDs)
- `build_user_content` reuses existing event/signal/match renderers
  — they already sanitize via `PromptSafety` post audit-P3

### What stays the same
- `messages_create` call path (no client construction changes)
- Citation validation (`valid_ids = events.map { |e| e[:id] }.to_set`)
- Circuit breaker integration
- Generic error message + server-side log split
- AI rate limiting (per-user + per-IP at `rack_attack`)

### Controller surface
Add **one** route:
```
POST /api/ai/explain
```
Body: `{ entity_type:, entity_id:, as_of?: }`

In `Api::AiController#explain`:
- `before_action :require_commander!` (already in place class-wide)
- `authorize_ai_action!` (already in place)
- Calls `Ai::SummaryService.call(summary_type: "entity_explainer", ...)`
- Same response envelope as `summary` action

Routes config: one line in `config/routes.rb`. Pundit gating: existing
`AiPolicy#explain?` defaulted via `commander?` — no new policy method
strictly needed (could reuse `summary?`).

---

## 4. Grounding + citation contract

### Tenant scope
- Entity must pass `policy_scope(EntityType).find_by(id: entity_id)`
  before any LLM call. Same discipline as
  `Recommendations::ExecutorService#find_scoped` (Codex backlog #2
  closure pattern). Cross-tenant entity_id returns 404.

### Replay propagation
- `as_of` flows from frontend → controller → service → all entity
  context queries
- Audit events: `where("occurred_at <= ?", as_of)` (matches
  existing `Replay::AuditSnapshotService` semantics)
- Rule fires: same cutoff, plus the `[record.updated_at, as_of].min`
  clamp pattern proven in the F3 manual-QA closure
- Live mode: same code path with `as_of: nil` — service treats nil
  as "no upper bound"

### Citation contract
- Service emits citations only from the audit events it actually
  sent to the model (the Briefing pattern, proven in production)
- LLM cannot fabricate a citation UUID for an event we did not
  send — the validation set is computed from sent IDs, not from
  whatever the model returns
- Frontend renders citations as expandable refs that deep-link
  to the audit timeline at that occurred_at
- If the LLM returns zero valid citations, the explanation still
  renders but with a "no specific events cited" footer — honesty
  over false confidence

### Prompt safety
- Every user-controlled string in the prompt flows through
  `Ai::PromptSafety` (already wired post audit-P3 closure):
  - Entity name (site name / incident title / signal external_id)
    via `sanitize_for_prompt`
  - Audit-event before/after snapshots via `sanitize_snapshot`
    (recursive)
- No new sanitization surfaces introduced — every prompt input
  already has a safe path

---

## 5. Test surface

### Backend specs (must exist before un-fixme'ing the slice)

**`spec/services/ai/summary_service_spec.rb` — extend with
`describe "entity_explainer"`:**
- accepts `entity_explainer` summary_type
- rejects when `entity_id` not in user's policy_scope (cross-tenant
  guard)
- propagates `as_of` to the audit-event query
- emits citations only from sent audit IDs (citation-fabrication
  prevention)
- sanitizes entity name in system prompt (wire-layer assertion on
  `args[:system]`, matching the f149dbf+c44754c pattern)
- returns `ServiceResult.failure` with generic message on Anthropic
  error (preserves audit-P3 error-exposure fix)
- circuit-breaker open → fails closed without invoking Anthropic

**`spec/requests/api/ai_spec.rb` — extend with `describe "POST /explain"`:**
- 200 success path with valid entity
- 422 on missing required params
- 403 for viewer role
- 404 on cross-tenant entity_id (proves `policy_scope` enforcement
  at the controller layer in addition to service)
- rate-limit headers present (existing `rack_attack` integration)

### Frontend tests

**`src/test/AiExplainerPanel.test.tsx` (new component spec):**
- renders Explain button when entity selected
- hides Explain button when no selection
- disables button + tooltip for viewer role
- shows skeleton while generating
- renders 4-section output on success
- renders Callout on failure
- regenerate button hidden during replay

**`src/test/useAiExplain.test.ts` (new hook spec):**
- POSTs `/api/ai/explain` with correct body shape
- propagates `as_of` from `useReplay()` context
- 30s frontend debounce (regenerate spam guard)

### Manual smoke (tomorrow, before any code)
- `flyctl ssh console --app resilience-ops` → `bin/rails console`
- `Ai::SummaryService.call(summary_type: "leadership_briefing", user: User.first)`
- If returns success → Anthropic credit OK, proceed with slice
- If returns failure with credit error → fix key first, defer slice

---

## 6. Rollout order

Five commits. Each independently reviewable; if any one fails Codex
`/gate`, only that one needs rework.

### Commit 1: Backend service + endpoint (no UI)
- Extend `SummaryService` with `entity_explainer` summary_type
- Add `POST /api/ai/explain` route + controller action
- Backend specs (service-level + request-level)
- Validation: rspec green, brakeman 0
- Demo state: `curl` against the endpoint produces a real
  explanation; no UI yet

### Commit 2: Frontend hook + component (not yet wired)
- `useAiExplain` hook (POSTs `/api/ai/explain`, debounce, error
  handling)
- `<AiExplainerPanel>` component (button + skeleton + result + error
  states)
- Component specs
- Validation: tsc -b clean, vitest green
- Demo state: component exists in isolation, can be storybook'd or
  manually rendered

### Commit 3: Wire into MapPage inspector
- Add `<AiExplainerPanel>` to the map inspector for the three
  selection variants
- Pass `entity_type` + `entity_id` + `as_of` from existing context
- One spec proving the panel renders for each variant
- Validation: full vitest + tsc, manual /map walkthrough
- Demo state: `/map` operator can click Explain on any selection

### Commit 4: Wire into GlobePage inspector
- Same wire-up, mirror pattern
- Same spec coverage
- Validation: tsc + vitest
- Demo state: feature parity across map and globe

### Commit 5: Handoff rotation + deploy
- Update `execution_handoff.md` with the new slice closure
- `flyctl deploy --app resilience-ops`
- Smoke-verify `/up`, `/login`, then click Explain end-to-end on a
  real selection in production
- Demo state: live URL has working feature for recruiters

### Out-of-scope for this slice (deferred)
- MapPage / GlobePage / EntityCard decomposition (architecture debt,
  not blocking)
- Engine-init failure-state UI (separate concern)
- Globe E2E un-fixme (separate harness slice)
- A second AI feature (one wow at a time)

---

## 7. Open questions — validate tomorrow before any code

1. **Anthropic credit on production key.** `flyctl ssh console` →
   smoke check via Rails console. Hard blocker if exhausted.
2. **Existing summary path tolerates entity-scoped fetch?** Quick
   read of `SummaryService#fetch_events` to confirm extending it
   with an `entity_id`/`entity_type` filter is mechanical, not a
   design fight.
3. **Inspector panel layout has room?** Visual check on /map and
   /globe — does adding an Explain button + result section break
   the existing inspector layout, or fit cleanly?

---

## 8. Done criteria

The slice is "done" when:
- All 5 commits shipped to `main` with green gates
- Production deployed and smoke-verified
- Real Anthropic call returns a real explanation in <5s for a
  representative selection
- Citations link correctly to audit timeline entries
- Replay mode produces an explanation grounded to historical state
  (provably different from live for a record that has changed)
- Viewer role correctly blocked at the API layer (not just UI hide)
- Backend rspec + frontend vitest + tsc + brakeman all green
- `execution_handoff.md` rotated to reflect the new feature live

Anything short of all eight is "in progress."

---

## 9. Risks (tracked, not fixed)

- **Anthropic credit exhaustion mid-demo** — production key could
  be drained between deploy and recruiter call. Mitigation: monitor
  `Metrics::Recorder` ai_call counters; consider a budget alert if
  this slice ships before the demo window.
- **Latency** — Anthropic Haiku at 200-token prompt typically
  returns in 1-3s. If we feed too much context (full audit chain
  for a noisy site), latency could push past 5s and feel slow.
  Mitigation: cap audit events at `MAX_EXPLAIN_AUDIT_EVENTS = 15`
  (vs 40 for full briefing) — explainer is meant to be tight.
- **Citation rendering UX gap** — if the audit timeline link
  doesn't deep-link cleanly to a specific occurred_at, the citation
  loses some grounding feel. Mitigation: confirm or build the
  deep-link before commit 3.
- **Inspector visual debt** — adding to a 875-line MapPage means
  the file gets longer, not shorter. Decomposition is still
  deferred, this slice doesn't help that. Tracked, not blocking.

---

## 10. Why this is the right next slice

- **Demo-friendly:** every recruiter / external evaluator
  immediately understands "select something, AI explains it."
- **Compounds existing investment:** four hardened systems light
  up at once; nothing built has been wasted.
- **Low novel-architecture risk:** zero new services, zero new
  infrastructure, zero new policy classes. The hardest part is
  the prompt template, not the plumbing.
- **Honest grounding story:** every claim is anchored to an
  AuditEvent UUID. Recruiters who care about hallucination see
  the citations and understand the safety model.
- **Replay-aware:** the same feature works in time-travel mode,
  which is itself a differentiator vs typical AI dashboards.

If the gating check tomorrow passes, build it. If not, fix the gate
first.
