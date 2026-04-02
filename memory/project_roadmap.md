---
name: project_roadmap
description: Current build order and major next tracks
type: roadmap
---

# Resilience — Current Roadmap

## Source of Truth

1. Actual code in the repo
2. This roadmap
3. `memory/project_resilience.md`

If this roadmap disagrees with code, prefer code and then update memory.

## Shipped

- Canonical v1 through Phase 4
- Kill-chain / prosecution workflow
- Cross-entity natural-language ontology query
- Globe heatmap parity
- Playback-grade multi-asset trails
- SSE/thread scaling hardening
- Pundit auth-layer finish
- AI service hardening parity

## Current Local Hardening Tranche

These changes exist in the current working tree and are intended to land together:

1. Replay parity tranche:
   - historical briefing generation
   - historical swimlane windows
2. Telemetry simulator safety:
   - explicit `TELEMETRY_SIMULATOR_ENABLED` boot gate
3. Recommendation LLM hardening:
   - timeout, zero retries, env-overridable model, observability
4. AIS gap confidence correctness:
   - exact AO polygon containment instead of bounding-box scoring
5. Relay liveness visibility:
   - relay heartbeat/error status in `OperationalStatus`
6. Shared AI resilience layer:
   - Anthropic circuit breaker across planner/enricher services
7. Session revocation:
   - JWT `jti` denylisting on logout

## Next Major Tracks After This Tranche

These are the real remaining programs. They are not “small hardening patches.”

1. Replay parity backlog
   - Recommendations
   - Ontology query
   - Incident detail
   - Alert triage
2. Security/identity maturity
   - richer RBAC than `operator` / `commander`
   - session lifecycle beyond single-token logout revocation
3. Tenant/workspace isolation
   - domain-wide data scoping
   - policy/query isolation
4. Frontend decomposition
   - split the largest engine/page files into smaller maintained units

## Explicit Non-Goals For The Current Tranche

- Do not pretend tenant isolation is a quick patch.
- Do not add a “viewer” role without a full permission model.
- Do not mark replay-complete pages as historically accurate unless the backend state reconstruction exists.
