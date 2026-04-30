---
name: project_roadmap
description: Current build order and major next tracks
type: roadmap
---

# Resilience — Current Roadmap

## Source of Truth

1. Actual code in the repo
2. `memory/execution_context.md`
3. `memory/execution_handoff.md`
4. This roadmap
5. `memory/project_open_findings.md`
6. `memory/project_production_readiness_plan.md`
7. `memory/project_resilience.md`

If this roadmap disagrees with code, prefer code and then update memory.

## Current Working Rule

The production-readiness program is **complete** as of 2026-04-09, and Phases 1–7 of the execution roadmap shipped through 2026-04-22.

Active slice execution and model handoff live in:

- `memory/execution_context.md`
- `memory/execution_handoff.md`
- `.claude/skills/resilience-remediation/references/findings.md` (audit remediation backlog)

This file tracks major future programs. It is not the active dirty-tree handoff file.

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
- Phase 1 — Trustworthy Operational Picture (freshness/source-health model, ambient trust indicators, SSE health visibility)
- Phase 2 — Map Workstation + Triage-in-Context (docked context panel, scoped triage-in-context)
- Phase 3 — Spatial Analytics + Spatial Trust Rendering (freshness rendered spatially, evidence-linked spatial highlighting)
- Phase 4 — Debrief (debrief entry flow, meaningful-event timeline, click-to-reconstruct, temporal diff)
- Phase 5 — Evidence Threading (provenance across alerts/incidents/recommendations, stale-basis warnings, shared evidence interface)
- Phase 6 — Performance Characterization (globe + map benchmarks, documented budgets, CI-enforced thresholds)
- Phase 7 — Advanced Geospatial Tools (measurement, annotations, range rings, bearing line, sector overlay)
- Audit remediation Band A (I1 evaluator window, G1 chokepoint truncation, API1 invalid-datetime, D1 partition-cache rollback) and Band B (I2 GPSJam wall-clock, R1 replay projection truncation) — shipped in `27831e1`

## Current Major Tracks

These are the real remaining programs.

1. ~~Production readiness execution~~ — **COMPLETE** (2026-04-09)
2. ~~Execution-context Phases 1–7~~ — **COMPLETE** (2026-04-22)
3. ~~Audit remediation~~ — **COMPLETE**
4. Operational AI restore
   - restore Anthropic credits/key so `/briefing` and `/ontology` are demo-live
5. Frontend decomposition (deferred, on-demand)
   - `MapPage.tsx` is the only deliberately deferred large-file debt
6. GPU-proof policy / infra
   - keep GPU-dependent map Playwright local/manual until a reliable GPU CI lane exists
7. Security/identity maturity (future)
   - richer role modeling beyond current 4-role system
   - org admin vs platform admin separation
8. Tenant/workspace isolation (future)
   - full multi-tenant admin UI and workspace management
   - domain-wide data scoping beyond current org/AO enforcement
9. Stakeholder-blocked `4B`
   - access-pattern anomaly detection remains blocked on threat-model/product direction
10. Spatial baseline/documentation cleanup
   - keep PostGIS-backed schema reality, local test setup, and comments/docs aligned

## Explicit Non-Goals For The Current Tracks

- Do not pretend tenant isolation is a quick patch.
- Do not mark replay-complete pages as historically accurate unless the backend state reconstruction exists.
