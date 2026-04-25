# Claim Verification Checklist

Use this when verifying external reviews.

## Repo Snapshot

Always record:
- current HEAD
- dirty-tree status
- whether a claim is true on committed HEAD, dirty tree, or neither

## Common Overclaim / False-Positive Traps

### "No E2E tests"

Check:
- `frontend/e2e`
- any backend integration or pipeline specs

### "No tenant isolation"

Check:
- `ApplicationPolicy`
- policy scopes
- request specs
- background jobs
- SSE streams
- broadcasters
- recommendation and correlation paths

### "No CSRF protection"

Check actual auth/session controller behavior, same-site cookie settings, and origin / referer checks.

### "No metrics / observability"

Distinguish:
- no Prometheus / OTel
- from no observability at all

Internal metrics, operational-status snapshots, Sentry, Lograge, and benchmark artifacts all count.

### "No agentic AI"

Be precise:
- good structured tool use is real
- validation is real
- circuit breaking is real
- lack of multi-step loops is also real

Do not collapse those into one judgment.

### "Trust model is naive"

Inspect the actual formulas.
Do not trust UI copy or examples in external reviews.

### "Production-ready"

Check for:
- boring setup path
- CI realism
- runtime assumptions
- load evidence
- observability
- failure-mode handling

"Production-shaped" is not the same as "production-proven."

## Project-Specific Hotspots For Resilience

### Replay

Check:
- `ReplayContext`
- `useReferenceTimeMs`
- backend projection / audit reconstruction
- mutation guards during replay

### Correlation

Check:
- evaluator targeting
- cooldown atomicity
- corroboration logic
- confidence and risk math

### Telemetry / SSE

Check:
- admission control
- lease refresh
- broadcaster fanout / routing
- policy refresh during long-lived streams

### AI

Check:
- scoped data access
- schema-bounded tool use
- recommendation validator
- citation allowlists
- eval harness or lack of it

### Portfolio / CTO Scoring

Check whether the repo has:
- one undeniable end-to-end workflow
- one subsystem with distinctive technical judgment
- any public-quality architectural articulation
- evidence of real restraint, not just surface area
