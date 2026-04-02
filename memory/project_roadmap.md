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
- Historical briefing + historical swimlane replay tranche
- Telemetry simulator safety gate
- Recommendation LLM hardening
- Exact AO polygon containment for AIS gap confidence
- Relay liveness visibility
- Shared AI circuit breaker
- JWT logout revocation
- Scoped API authorization enforcement across collections, member lookups, aggregate endpoints, and entity-scoped audit history
- Viewer-role schema parity plus scoped request-matrix proof

## Current Major Tracks

These are the real remaining programs. They are not “small hardening patches.”

1. Replay parity backlog
   - Recommendations
   - Ontology query
   - Incident detail
   - Alert triage
2. Security/identity maturity
   - richer role modeling beyond `viewer` / `operator` / `commander`
   - session lifecycle beyond single-token logout revocation
3. Tenant/workspace isolation
   - domain-wide data scoping
   - policy/query isolation
4. Frontend decomposition
   - split the largest engine/page files into smaller maintained units
5. Spatial baseline/documentation cleanup
   - keep PostGIS-backed schema reality, local test setup, and comments/docs aligned

## Explicit Non-Goals For The Current Tracks

- Do not pretend tenant isolation is a quick patch.
- Do not mark replay-complete pages as historically accurate unless the backend state reconstruction exists.
