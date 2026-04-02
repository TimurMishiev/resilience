require "rails_helper"

# ---------------------------------------------------------------------------
# End-to-end pipeline integration test
#
# Exercises the full critical path:
#   ExternalSignal persisted
#     → EvaluatorService.call(signal:) evaluates all active rules
#     → RuleFiringService fires: creates Task + SignalRuleMatch (alert)
#     → FusionService opens an Incident and links the alert
#     → GenerationJob (synchronous) produces at least one Recommendation
#     → API endpoints return the incident and recommendation
#
# EvaluatorService normally enqueues RuleFiringJob. We instead call
# RuleFiringService directly after confirming the evaluator matches,
# to run synchronously without an ActiveJob adapter dependency.
# ---------------------------------------------------------------------------
RSpec.describe "End-to-end signal pipeline", type: :request do
  let!(:commander) { create(:user, :commander) }
  let!(:area)      { create(:area_of_operation, threat_level: "red") }

  # Site placed at lat/lng 10.0 / 20.0
  let!(:site) do
    create(:site,
      latitude:          10.0,
      longitude:         20.0,
      status:            "active",
      area_of_operation: area)
  end

  # Rule matches seismic_event within 100 km, cooldown=0, creates a task.
  let!(:rule) do
    create(:correlation_rule,
      :no_cooldown,
      is_active:  true,
      conditions: { "signal_type" => "seismic_event", "proximity_km" => 100 },
      actions:    { "create_task" => { "title" => "Seismic alert near {{site_name}}", "priority" => "high" } },
      created_by: commander)
  end

  def json
    JSON.parse(response.body)
  end

  it "carries a seismic signal through to a recommendation" do
    # ── Phase 1: signal ingestion ─────────────────────────────────────────
    signal = ExternalSignal.create!(
      source:      "usgs_seismic",
      signal_type: "seismic_event",
      lat:         10.045,   # ~5 km north of site — well within 100 km
      lng:         20.0,
      occurred_at: Time.current,
      external_id: "eq-e2e-test-001",
      raw_payload: { "mag" => 4.2, "place" => "Pipeline test location" },
    )

    expect(signal).to be_persisted

    # ── Phase 2: evaluator confirms rule matches ───────────────────────────
    evaluator = Correlations::EvaluatorService.new(signal: signal)
    expect(evaluator.matches_rule_at_site?(rule, site)).to be true

    # ── Phase 3: fire the rule (synchronous — skips RuleFiringJob) ─────────
    fired = Correlations::RuleFiringService.call(rule: rule, signal: signal, site: site)

    expect(fired.success).to be true

    match = fired.payload[:match]
    task  = fired.payload[:task]

    # ── Phase 4: alert created with correct attributes ─────────────────────
    expect(match).to be_a(SignalRuleMatch)
    expect(match.site_id).to eq(site.id)
    expect(match.correlation_rule_id).to eq(rule.id)
    expect(match.workflow_status).to eq("unacknowledged")
    expect(match.confidence).to be > 0.0

    # ── Phase 5: task created ──────────────────────────────────────────────
    expect(task).to be_a(Task)
    expect(task.site_id).to eq(site.id)
    expect(task.priority).to eq("high")
    expect(task.title).to include(site.name)

    # ── Phase 6: incident fused ────────────────────────────────────────────
    # FusionService is called inside RuleFiringService post-commit.
    match.reload
    expect(match.incident_id).not_to be_nil

    incident = Incident.find(match.incident_id)
    expect(incident.site_id).to eq(site.id)
    expect(incident.status).to eq("open")
    expect(incident.confidence).to be > 0.0

    # ── Phase 7: recommendations generated ────────────────────────────────
    # GenerationJob is enqueued by FusionService on :created. Run inline.
    Recommendations::GenerationJob.new.perform

    expect(Recommendation.active.count).to be >= 1

    # ── Phase 8: API returns the incident and recommendations ──────────────
    get "/api/incidents", headers: auth_headers(commander)
    expect(response).to have_http_status(:ok)
    expect(json["data"].map { |i| i["id"] }).to include(incident.id)

    get "/api/recommendations", headers: auth_headers(commander)
    expect(response).to have_http_status(:ok)
    expect(json["data"]).not_to be_empty
  end
end
