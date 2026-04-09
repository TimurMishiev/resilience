---
name: project_roadmap
description: Current build order and major next tracks
type: roadmap
---

# Resilience — Current Roadmap

## Source of Truth

1. Actual code in the repo
2. `memory/project_production_readiness_plan.md`
3. This roadmap
4. `memory/project_resilience.md`

If this roadmap disagrees with code, prefer code and then update memory.

## Current Working Rule

The production-readiness program is **complete** as of 2026-04-09.
Feature roadmap work may now resume. This file is the active execution queue.

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
- Replay parity for recommendations, ontology query, incident detail, and alert triage
- Replay parity across entity drawers, areas, correlation rules, site detail, dashboard, and map/globe operational overlays
- Production readiness program (replay parity, tenant boundary hardening, security/capability maturity, frontend decomposition, SSE ceiling documentation)

## Current Major Tracks

These are the real remaining programs. They are not “small hardening patches.”

1. ~~Production readiness execution~~ — **COMPLETE** (2026-04-09)
2. Security/identity maturity (future)
   - richer role modeling beyond current 4-role system
   - org admin vs platform admin separation
3. Tenant/workspace isolation (future)
   - full multi-tenant admin UI and workspace management
   - domain-wide data scoping beyond current org/AO enforcement
4. Frontend decomposition (future, on-demand)
   - remaining large pages (`AlertTriagePage`, `GraphPage`, `SignalFeedPage`) if velocity demands it
5. Spatial baseline/documentation cleanup
   - keep PostGIS-backed schema reality, local test setup, and comments/docs aligned

## Explicit Non-Goals For The Current Tracks

- Do not pretend tenant isolation is a quick patch.
- Do not mark replay-complete pages as historically accurate unless the backend state reconstruction exists.
