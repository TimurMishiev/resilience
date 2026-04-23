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
- Status: fixed and shipped on `2026-04-22`
- Fix summary:
  - `Api::TelemetryController#stream` now snapshots `policy_scope(Asset).pluck(:id).to_set` once at stream open and drops any payload whose `asset_id` is outside that set. Uses the same `AssetPolicy::Scope` as the `/api/telemetry` snapshot endpoint, so live + replay share one authoritative tenant gate.
  - Controller-local extraction `telemetry_payload_visible?` handles malformed queue payloads by logging and skipping (matches `Api::EventsController` pattern).
  - `TelemetryReadingPolicy` carries a comment documenting that per-payload tenant filtering lives in the controller, not Pundit.
  - No simulator, broadcaster, schema, or route changes — minimum-viable fix that closes the cross-tenant leakage risk without widening blast radius.
- Tests:
  - 5 new request specs in `spec/requests/api/telemetry_spec.rb` covering: unrestricted viewer, org-only viewer, AO-only viewer, compound org+AO viewer, empty-scope viewer.

#### `MT2` — Recommendation Context Assembly Reads Global Operational State
- Severity: `P1` for multi-tenant readiness
- Status: fixed and shipped on `2026-04-22`
- Fix summary:
  - `Recommendations::ContextAssembler.call(organization_id: nil)` — `organization_id: nil` preserves pre-MT2 global-read behavior for single-tenant deployments; when set, every query (alerts, incidents, tasks, sites, risk snapshots, assets, postures) filters via the entity's tenant anchor (site.organization_id, AO.organization_id, or home_site.organization_id). Incidents without a site fall back to AO.organization_id; records that can't be attributed are excluded.
  - `Recommendations::GeneratorService.call(organization_id: nil)` threads the id through to the assembler and tags log lines with tenant for observability.
  - `Recommendations::GenerationJob#perform` enumerates `Organization.pluck(:id)`. With zero organizations it runs once unscoped (single-tenant fallback). With N orgs it runs N times, aggregating `created` / `invalid_count` and isolating per-tenant failures (one tenant failing does not block the others). The advisory lock keeps the whole cycle one-at-a-time.
  - No schema change, no change to LlmEnricher / RuleEngine / Validator / RecommendationPolicy — the LLM call per tenant is a strict reduction in the data it sees.
- Tests:
  - 11 new context-assembler cases (one per query path + nil-fallback + AO-fallback for siteless incidents)
  - 2 new generator-service cases (tenant propagation into ContextAssembler; per-tenant entity scoping end-to-end)
  - 3 new generation-job cases (single-tenant fallback, per-tenant loop + aggregation, per-tenant failure isolation)

#### `MT3` — Correlation Target Sites Go Global When Rule AO Is Nil
- Severity: `P2` for multi-tenant readiness
- Status: fixed and shipped on `2026-04-22`
- Fix summary:
  - `Correlations::EvaluatorService.target_sites_scope` now uses a three-branch tenant resolution: (1) AO-scoped rule → sites in that AO; (2) nil-AO rule whose creator has an organization → sites in the creator's org; (3) nil-AO rule by an admin with no org → `Site.active` (unchanged, preserves admin-global rules).
  - `Correlations::EvaluatorService.rule_targets_site?` mirrors the same three-branch logic so the single-site membership check used by `RuleFiringJob` stays consistent with bulk target resolution.
  - `CorrelationRule.active.includes(:created_by)` preloads the creator in the evaluator to avoid an N+1 user query per rule per signal (ran every 30s via `Correlations::EvaluateRecentJob`).
  - No schema change. No migration. No policy rewrite. The finding's literal "no `organization_id` column on correlation_rules" is a stylistic note; correctness is achieved via the existing tenant anchors (`area_of_operation.organization_id` and `created_by.organization_id`). A future schema-level canonical form remains strictly additive if desired.
- Tests:
  - `contain_exactly` invariants on `target_sites_scope` across all three branches plus the `site_id` short-circuit (4 cases)
  - A consistency proof that `rule_targets_site?` agrees with `target_sites_scope` for every (rule, site) pair across all three branches (1 case)
  - An end-to-end leak-closure case proving an org-A commander's nil-AO rule does not fire against an org-B signal at an org-B site (1 case)

### Band D — Lower-Priority Hardening

#### `F1` — `BriefingPanel` Can Render A Stale Response Under A New Header
- Severity: `P3`
- Status: fixed and shipped in `43ea358` on `2026-04-22`
- Why real:
  - `result.summary` / `citations` / `context_counts` were keyed to response-time state
  - `result` card header and context hint read *current* selector state, so changing selectors after a successful generate rendered stale body under a new header
  - `handleExport` mixed current-state (`summary_type`, `site_name`) with stale-result (`summary`, `citations`, `context_counts`), producing mis-labeled exported PDFs
- Risk:
  - operator-visible trust break (stale briefing appears to describe the currently-selected site/type)
  - data integrity regression in exported classified-style PDFs
- Fix direction (applied):
  - capture `{ summary_type, site_id, site_name, as_of }` at generate time into a `BriefingResultContext` stored alongside the response data
  - render the captured context as an anchored header on the result Card so operators see exactly which briefing they are viewing
  - `handleExport` now sources `summary_type` and `site_name` from the captured context, never from current selector state
- Primary files:
  - [BriefingPanel.tsx](/Users/timurmishiev/Desktop/Code/resilience/frontend/src/components/BriefingPanel.tsx)
  - [BriefingPanel.test.tsx](/Users/timurmishiev/Desktop/Code/resilience/frontend/src/test/BriefingPanel.test.tsx)
- Validation minimum:
  - focused Vitest proving the captured header + captured-export params (3 new cases)

#### `O1` — Metrics Latency Window Claim Does Not Match Implementation
- Severity: `P3`
- Status: fixed in working tree on `2026-04-22`
- Why real:
  - [metrics/recorder.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/metrics/recorder.rb) declared `LATENCY_WINDOW = 5.minutes` and published it as `window_seconds` (line 81)
  - `persist_request_latency!` calls `@request_samples.clear` on every invocation (line 60), so the effective window equals the snapshot cadence
  - [recurring.yml](/Users/timurmishiev/Desktop/Code/resilience/backend/config/recurring.yml) schedules `metrics_snapshot` `every minute` — so samples are cleared every 60s, not every 300s
  - docstring and comment both claimed a `rolling 5-min window`
- Risk:
  - operators / downstream consumers reading `window_seconds: 300` are misled about the aggregation window
  - alert thresholds or SLOs derived from the published window would be wrong by 5×
- Fix direction (applied):
  - reconciled the claim to reality: `LATENCY_WINDOW = 1.minute`, matching the snapshot cadence
  - rewrote the header comment to state that the window tracks the snapshot cadence by design (samples are cleared on each snapshot)
  - behavior unchanged — this is a labeling/correctness fix, not a windowing-semantics change
- Primary files:
  - [metrics/recorder.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/services/metrics/recorder.rb)
  - [recurring.yml](/Users/timurmishiev/Desktop/Code/resilience/backend/config/recurring.yml)
  - [recorder_spec.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/spec/services/metrics/recorder_spec.rb)
- Validation minimum:
  - focused recorder spec proving `payload["window_seconds"] == 60` after `snapshot!`

#### `J1` — No `RevokedJwt` Pruning Job
- Severity: `P3`
- Status: fixed in working tree on `2026-04-22`
- Why real:
  - [revoked_jwt.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/models/revoked_jwt.rb) has `.active` scope (`expires_at > Time.current`) but retained every row forever
  - no pruning job existed in [backend/app/jobs](/Users/timurmishiev/Desktop/Code/resilience/backend/app/jobs); the table grew unboundedly as tokens churned
- Note:
  - indexed lookup exists (`index_revoked_jwts_on_jti`, `index_revoked_jwts_on_expires_at`), so this was not an acute auth-path failure — pure maintenance debt
- Fix direction (applied):
  - new `Auth::PruneRevokedJwtsJob` deletes rows where `expires_at <= Time.current`; inverse of `RevokedJwt.active`
  - scheduled daily (`every day at 2:30am`) in `config/recurring.yml` — JWT TTL is 24h (`JwtAuthenticatable::TTL`), so a daily cadence reliably drains the table without contention with other nightly jobs
  - job-level spec proves boundary alignment with `.active` so future refactors cannot desync the inactive ⇄ prunable contract
- Primary files:
  - [auth/prune_revoked_jwts_job.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/jobs/auth/prune_revoked_jwts_job.rb)
  - [recurring.yml](/Users/timurmishiev/Desktop/Code/resilience/backend/config/recurring.yml)
  - [prune_revoked_jwts_job_spec.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/spec/jobs/auth/prune_revoked_jwts_job_spec.rb)
- Validation minimum:
  - focused job spec proving expired rows delete, live rows survive, and boundary (`expires_at == Time.current`) rows are pruned

#### `M1` — Migration Safety Program
- Severity: `P3`
- Status: fixed in working tree on `2026-04-22`
- Why real:
  - production-scale migrations on a live PostgreSQL deployment can hold long locks, backfill NOT NULL columns on large tables, or add non-concurrent indexes — each a known path to production stalls
  - the repo had no write-time guardrail catching these patterns before deploy
- Fix direction (applied):
  - added `strong_migrations` (2.6.0) to the default group in [Gemfile](/Users/timurmishiev/Desktop/Code/resilience/backend/Gemfile)
  - created [config/initializers/strong_migrations.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/config/initializers/strong_migrations.rb) with `start_after = 20260415100001` — the timestamp of the latest existing migration — so historical migrations are never retroactively flagged
  - any migration added after the baseline is validated at write time; runs in the test env during every `db:prepare`, so CI (which runs the full RSpec suite) exercises the guardrail automatically
  - added [spec/config/strong_migrations_spec.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/spec/config/strong_migrations_spec.rb) with a drift guard that fails if `start_after` is ever bumped past an existing migration (prevents silencing warnings on real new migrations)
- Primary files:
  - [Gemfile](/Users/timurmishiev/Desktop/Code/resilience/backend/Gemfile)
  - [config/initializers/strong_migrations.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/config/initializers/strong_migrations.rb)
  - [spec/config/strong_migrations_spec.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/spec/config/strong_migrations_spec.rb)
- Validation minimum:
  - focused spec proving the gem loads and the baseline cannot silently outrun existing migrations
- Note:
  - this is a seed, not a retrospective audit of past migrations — existing migrations have already been deployed; the program's value is catching future regressions
  - if a future deploy does require changing a hot table's shape, the checker will raise with the documented safe-transform pattern and the operator will have a decision point

## Rejected / Unconfirmed / Strategic Only

- `SignalsController` external-signal baseline scoping:
  - intentionally global under [external_signal_policy.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/app/policies/external_signal_policy.rb)
- `DebriefPanel` ordering flake:
  - unconfirmed; isolated file passes
- AI cache removal:
  - freshness-vs-load trade-off, not a standalone defect
- CTO roadmap items:
  - valid strategic proposals, not merged defects
