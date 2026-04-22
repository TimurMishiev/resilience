# Resilience Remediation Findings

This is the merged, confirmed findings matrix from:
- Codex full-system audit
- Claude forensic audit
- Claude targeted gap audit

Use this file as the canonical remediation backlog.

## Confirmed Findings

### Band A — Fix Before New Roadmap Work

#### `I1` — Correlation Evaluator Window Misses Most Signals
- Severity: `P1`
- Status: fixed and shipped in `27831e1` on `2026-04-22`
- Why real:
  - [evaluate_recent_job.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/jobs/correlations/evaluate_recent_job.rb) uses `WINDOW_SECONDS = 12`
  - [recurring.yml](/Users/timurmishiev/Desktop/Code/resilience/backend/config/recurring.yml) schedules the job every `30 seconds`
  - comments still say `every 10 seconds`
- Risk:
  - signals ingested 12–30 seconds before a run are never evaluated for correlations or geofence breaches
- Primary files:
  - [evaluate_recent_job.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/jobs/correlations/evaluate_recent_job.rb)
  - [recurring.yml](/Users/timurmishiev/Desktop/Code/resilience/backend/config/recurring.yml)
  - [correlation_evaluator.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/config/initializers/correlation_evaluator.rb)
  - [evaluate_recent_job_spec.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/spec/jobs/correlations/evaluate_recent_job_spec.rb)
- Validation minimum:
  - focused job spec proving a signal inside the old dead zone is now evaluated

#### `G1` — Chokepoints Truncate Silently On `/map` And `/globe`
- Severity: `P2`
- Status: fixed and shipped in `27831e1` on `2026-04-22`
- Why real:
  - [MapPage.tsx](/Users/timurmishiev/Desktop/Code/resilience/frontend/src/pages/MapPage.tsx) and [GlobePage.tsx](/Users/timurmishiev/Desktop/Code/resilience/frontend/src/pages/GlobePage.tsx) fetch chokepoints with `per_page: 200`
  - [useChokepoints.ts](/Users/timurmishiev/Desktop/Code/resilience/frontend/src/hooks/useChokepoints.ts) only fetches one page
  - [base_controller.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/controllers/api/base_controller.rb) caps pagination at `200`
- Risk:
  - spatial operator surfaces silently omit chokepoints beyond the first page
- Primary files:
  - [MapPage.tsx](/Users/timurmishiev/Desktop/Code/resilience/frontend/src/pages/MapPage.tsx)
  - [GlobePage.tsx](/Users/timurmishiev/Desktop/Code/resilience/frontend/src/pages/GlobePage.tsx)
  - [useChokepoints.ts](/Users/timurmishiev/Desktop/Code/resilience/frontend/src/hooks/useChokepoints.ts)
  - [chokepoints_controller.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/controllers/api/chokepoints_controller.rb)
- Validation minimum:
  - direct proof that `>200` chokepoints remain visible on both main spatial surfaces or their shared data path

#### `API1` — Controllers Accept Invalid Datetimes And Return Wrong Data
- Severity: `P2`
- Status: fixed and shipped in `27831e1` on `2026-04-22`
- Why real:
  - [signal_rule_matches_controller.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/controllers/api/signal_rule_matches_controller.rb) and [vessels_controller.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/controllers/api/vessels_controller.rb) `#tracks` both used `safe_parse_datetime`
  - [base_controller.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/controllers/api/base_controller.rb) returns `nil` on invalid parse
  - invalid `from` produced `WHERE occurred_at >= NULL`; invalid `to` was silently ignored
- Scope audited (other `safe_parse_datetime` callers confirmed safe):
  - `SignalsController` — explicit `.nil?` rejections already present (lines 16/19/55)
  - `AuditEventsController` — truthy-guarded application (skips on nil, not wrong-data)
  - `ExportsController` → `Exports::BatchService` — guards with `@from.present?` / `@to.present?`
  - `AiController` / AI filter services — pass through nil and consumers handle absence
- Risk:
  - malformed filters returned `200 OK` with incorrect results instead of `400`
- Primary files:
  - [signal_rule_matches_controller.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/controllers/api/signal_rule_matches_controller.rb)
  - [vessels_controller.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/controllers/api/vessels_controller.rb)
  - [base_controller.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/controllers/api/base_controller.rb)
  - [signal_rule_matches_spec.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/spec/requests/api/signal_rule_matches_spec.rb)
  - [vessels_spec.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/spec/requests/api/vessels_spec.rb)
- Validation minimum:
  - request-spec coverage for malformed `from` and `to` on both controllers

#### `D1` — `Telemetry::PartitionManager` Cache Survives Rolled-Back Partition Creation
- Severity: `P2`
- Status: fixed and shipped in `27831e1` on `2026-04-22`
- Why real:
  - [partition_manager.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/telemetry/partition_manager.rb) short-circuits on cached partition name
  - targeted spec currently fails with `no partition of relation "telemetry_readings" found for row`
- Risk:
  - stale cache can suppress real partition creation after rollback
- Primary files:
  - [partition_manager.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/telemetry/partition_manager.rb)
  - [partition_manager_spec.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/spec/services/telemetry/partition_manager_spec.rb)
- Validation minimum:
  - partition-manager spec green

### Band B — Fix Next For Trust / Historical Correctness

#### `I2` — GPSJam Uses Wall-Clock `occurred_at`
- Severity: `P2`
- Status: fixed and shipped in `27831e1` on `2026-04-22`
- Why real:
  - [gpsjam_ingestion_service.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/feeds/gpsjam_ingestion_service.rb) knows the source date lags 1–2 days
  - ingestion still writes `occurred_at: Time.current.utc`
- Risk:
  - replay is historically wrong
  - dedup semantics weaken
  - repeated daily data can look like fresh events every poll
- Primary files:
  - [gpsjam_ingestion_service.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/feeds/gpsjam_ingestion_service.rb)
  - [ingest_service.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/signals/ingest_service.rb)
  - relevant feed specs
- Validation minimum:
  - spec proving source date becomes stored `occurred_at`

#### `R1` — `Replay::ProjectionService` Silently Truncates At `100_000`
- Severity: `P2` latent / scale-triggered
- Status: fixed and shipped in `27831e1` on `2026-04-22`
- Why real:
  - [projection_service.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/replay/projection_service.rb) does chronological `.limit(MAX_EVENTS)` before folding latest per entity
- Risk:
  - high-churn entities can reconstruct to a stale historical snapshot with no warning
- Primary files:
  - [projection_service.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/replay/projection_service.rb)
  - [projection_service_spec.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/spec/services/replay/projection_service_spec.rb)
- Validation minimum:
  - spec proving latest-per-entity semantics under large event counts

### Band C — Required Before Multi-Tenant Shared Deployment

#### `MT1` — Telemetry SSE Stream Is Not Org-Scoped
- Severity: `P1` for multi-tenant readiness
- Status: confirmed latent defect
- Why real:
  - [telemetry_controller.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/controllers/api/telemetry_controller.rb) streams every broadcast payload to every subscriber
  - [simulator_service.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/telemetry/simulator_service.rb) publishes no `organization_id`
  - [telemetry_reading_policy.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/policies/telemetry_reading_policy.rb) allows `stream?` unconditionally
- Risk:
  - cross-tenant live telemetry leakage in a shared-org deployment
- Primary files:
  - [telemetry_controller.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/controllers/api/telemetry_controller.rb)
  - [simulator_service.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/telemetry/simulator_service.rb)
  - [telemetry_reading_policy.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/policies/telemetry_reading_policy.rb)

#### `MT2` — Recommendation Context Assembly Reads Global Operational State
- Severity: `P1` for multi-tenant readiness
- Status: confirmed latent defect
- Why real:
  - [context_assembler.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/recommendations/context_assembler.rb) performs global reads across alerts, incidents, tasks, sites, assets
  - [generation_job.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/jobs/recommendations/generation_job.rb) and [generator_service.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/recommendations/generator_service.rb) do not thread organization scope in
- Risk:
  - cross-tenant data enters recommendation generation / LLM context in shared-org deployment
- Primary files:
  - [context_assembler.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/recommendations/context_assembler.rb)
  - [generation_job.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/jobs/recommendations/generation_job.rb)
  - [generator_service.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/recommendations/generator_service.rb)

#### `MT3` — Correlation Target Sites Go Global When Rule AO Is Nil
- Severity: `P2` for multi-tenant readiness
- Status: confirmed latent defect
- Why real:
  - [evaluator_service.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/correlations/evaluator_service.rb) returns `Site.active` when `area_of_operation_id` is nil
  - [correlation_rule.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/models/correlation_rule.rb) has no `organization_id`
- Risk:
  - rule evaluation and alert creation can cross tenant boundaries in shared-org deployment
- Primary files:
  - [evaluator_service.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/correlations/evaluator_service.rb)
  - [correlation_rule.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/models/correlation_rule.rb)
  - [correlation_rule_policy.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/policies/correlation_rule_policy.rb)

### Band D — Lower-Priority Hardening

#### `F1` — `BriefingPanel` Can Render A Stale Response Under A New Header
- Severity: `P3`
- Status: confirmed current UI trust issue
- Primary files:
  - [BriefingPanel.tsx](/Users/timurmishiev/Desktop/Code/resilience/frontend/src/components/BriefingPanel.tsx)

#### `O1` — Metrics Latency Window Claim Does Not Match Implementation
- Severity: `P3`
- Status: confirmed observability correctness issue
- Primary files:
  - [metrics/recorder.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/metrics/recorder.rb)
  - [recurring.yml](/Users/timurmishiev/Desktop/Code/resilience/backend/config/recurring.yml)

#### `J1` — No `RevokedJwt` Pruning Job
- Severity: `P3`
- Status: confirmed maintenance debt
- Why real:
  - [revoked_jwt.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/models/revoked_jwt.rb) has active rows by expiry
  - no pruning job exists in [backend/app/jobs](/Users/timurmishiev/Desktop/Code/resilience/backend/app/jobs)
- Note:
  - indexed lookup exists, so this is not an acute auth-path failure

#### `M1` — Migration Safety Program
- Severity: `P3`
- Status: confirmed scale-only deployment risk
- Note:
  - this is not a current product defect
  - treat as a production-scale hardening program, not a local bugfix

## Rejected / Unconfirmed / Strategic Only

- `SignalsController` external-signal baseline scoping:
  - intentionally global under [external_signal_policy.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/policies/external_signal_policy.rb)
- `DebriefPanel` ordering flake:
  - unconfirmed; isolated file passes
- AI cache removal:
  - freshness-vs-load trade-off, not a standalone defect
- CTO roadmap items:
  - valid strategic proposals, not merged defects
