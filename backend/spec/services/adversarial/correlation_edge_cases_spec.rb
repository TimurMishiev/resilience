require "rails_helper"

# Adversarial edge-case tests for the correlation engine and recommendation
# pipeline. These target concurrent access, boundary conditions, and failure
# modes that are difficult to trigger in normal operation but can cause
# incorrect behavior under load.

RSpec.describe "Correlation Engine — adversarial edge cases", type: :service do
  include ActiveSupport::Testing::TimeHelpers

  before do
    allow(Sse::Broadcaster.instance).to receive(:publish)
    allow(Rails.logger).to receive(:info)
    allow(Rails.logger).to receive(:warn)
    allow(Rails.logger).to receive(:error)
  end

  let(:site) { create(:site, name: "Outpost", latitude: 10.0, longitude: 20.0) }

  # ---------------------------------------------------------------------------
  # Cooldown boundary: firing at exactly the cooldown expiry
  # ---------------------------------------------------------------------------
  describe "cooldown boundary precision" do
    let(:rule) do
      create(:correlation_rule,
             cooldown_minutes: 5,
             conditions: { "signal_type" => "seismic_event", "proximity_km" => 200 },
             actions: { "create_task" => { "priority" => "normal" } })
    end

    it "blocks a second fire within the cooldown window" do
      signal1 = create(:external_signal, lat: 10.0, lng: 20.0, signal_type: "seismic_event", source: "usgs_seismic")
      r1 = Correlations::RuleFiringService.call(rule: rule, signal: signal1, site: site)
      expect(r1.success).to be true

      signal2 = create(:external_signal, lat: 10.0, lng: 20.1, signal_type: "seismic_event", source: "usgs_seismic")
      r2 = Correlations::RuleFiringService.call(rule: rule.reload, signal: signal2, site: site)
      expect(r2.success).to be false
      expect(r2.errors).to include("cooldown")
    end

    it "allows firing immediately after cooldown expires" do
      signal1 = create(:external_signal, lat: 10.0, lng: 20.0, signal_type: "seismic_event", source: "usgs_seismic")
      r1 = Correlations::RuleFiringService.call(rule: rule, signal: signal1, site: site)
      expect(r1.success).to be true

      # Travel past cooldown
      travel_to(6.minutes.from_now) do
        signal2 = create(:external_signal, lat: 10.0, lng: 20.1, signal_type: "seismic_event", source: "usgs_seismic")
        r2 = Correlations::RuleFiringService.call(rule: rule.reload, signal: signal2, site: site)
        expect(r2.success).to be true
      end
    end
  end

  # ---------------------------------------------------------------------------
  # Cooldown atomicity: if task creation fails, cooldown must NOT be consumed
  # ---------------------------------------------------------------------------
  describe "cooldown rollback on action failure" do
    let(:rule) do
      create(:correlation_rule,
             cooldown_minutes: 60,
             conditions: { "signal_type" => "seismic_event", "proximity_km" => 200 },
             actions: { "create_task" => { "priority" => "normal" } })
    end

    it "does not consume cooldown when task creation fails" do
      signal = create(:external_signal, lat: 10.0, lng: 20.0, signal_type: "seismic_event", source: "usgs_seismic")

      # Sabotage task creation so it returns a failure
      allow(Tasks::CreationService).to receive(:call).and_return(
        ServiceResult.failure(errors: ["Simulated failure"])
      )

      # The service should raise inside the transaction, rolling back cooldown
      expect {
        Correlations::RuleFiringService.call(rule: rule, signal: signal, site: site)
      }.not_to change { rule.reload.last_fired_at }
    end
  end

  # ---------------------------------------------------------------------------
  # Fusion: exact boundary at FUSION_WINDOW
  # ---------------------------------------------------------------------------
  describe "fusion window boundary" do
    it "attaches to an incident updated just inside the window edge" do
      rule = create(:correlation_rule,
                    conditions: { "signal_type" => "seismic_event", "proximity_km" => 200 },
                    actions: { "create_task" => { "priority" => "normal" } })
      signal = create(:external_signal, lat: 10.0, lng: 20.0, signal_type: "seismic_event", source: "usgs_seismic")

      incident = create(:incident, site: site, status: "open", severity: "low",
                         opened_at: 7.hours.ago, title: "Old incident")
      # Set updated_at 1 second inside the fusion window
      incident.update_column(:updated_at, Incidents::FusionService::FUSION_WINDOW.ago + 1.second)

      match = create(:signal_rule_match, :without_task,
                     signal: signal,
                     correlation_rule: rule,
                     site: site,
                     fired_at: Time.current,
                     confidence: 0.5)

      result = Incidents::FusionService.call(match: match)
      expect(result.payload[:action]).to eq(:attached)
      expect(result.payload[:incident].id).to eq(incident.id)
    end

    it "creates a new incident when existing one is just past the window" do
      rule = create(:correlation_rule,
                    conditions: { "signal_type" => "seismic_event", "proximity_km" => 200 },
                    actions: { "create_task" => { "priority" => "normal" } })
      signal = create(:external_signal, lat: 10.0, lng: 20.0, signal_type: "seismic_event", source: "usgs_seismic")

      incident = create(:incident, site: site, status: "open", severity: "low",
                         opened_at: 7.hours.ago, title: "Stale incident")
      # Set updated_at 1 second past the window
      incident.update_column(:updated_at, Incidents::FusionService::FUSION_WINDOW.ago - 1.second)

      match = create(:signal_rule_match, :without_task,
                     signal: signal,
                     correlation_rule: rule,
                     site: site,
                     fired_at: Time.current,
                     confidence: 0.5)

      result = Incidents::FusionService.call(match: match)
      expect(result.payload[:action]).to eq(:created)
      expect(result.payload[:incident].id).not_to eq(incident.id)
    end
  end

  # ---------------------------------------------------------------------------
  # Fusion: severity ratchet never downgrades
  # ---------------------------------------------------------------------------
  describe "severity ratchet" do
    it "does not downgrade severity when a low-confidence match attaches to a critical incident" do
      rule = create(:correlation_rule,
                    conditions: { "signal_type" => "seismic_event", "proximity_km" => 200 },
                    actions: { "create_task" => { "priority" => "normal" } })
      signal = create(:external_signal, lat: 10.0, lng: 20.0, signal_type: "seismic_event", source: "usgs_seismic")

      incident = create(:incident, site: site, status: "open", severity: "critical",
                         opened_at: 1.hour.ago, title: "Critical incident")

      match = create(:signal_rule_match, :without_task,
                     signal: signal,
                     correlation_rule: rule,
                     site: site,
                     fired_at: Time.current,
                     confidence: 0.1)

      result = Incidents::FusionService.call(match: match)
      expect(result.payload[:action]).to eq(:attached)
      expect(result.payload[:incident].reload.severity).to eq("critical")
    end
  end

  # ---------------------------------------------------------------------------
  # Fusion: siteless match is skipped
  # ---------------------------------------------------------------------------
  describe "siteless match skip" do
    it "returns :skipped for a match without site_id" do
      signal = create(:external_signal, lat: 10.0, lng: 20.0, signal_type: "seismic_event", source: "usgs_seismic")
      match = build(:signal_rule_match, :without_task,
                    signal: signal,
                    site: nil,
                    fired_at: Time.current,
                    confidence: 0.5)
      match.save!(validate: false)

      result = Incidents::FusionService.call(match: match)
      expect(result.payload[:action]).to eq(:skipped)
    end
  end
end

RSpec.describe "Recommendation Pipeline — adversarial edge cases", type: :request do
  before do
    allow(Sse::Broadcaster.instance).to receive(:publish)
    allow(Rails.logger).to receive(:info)
    allow(Rails.logger).to receive(:warn)
    allow(Rails.logger).to receive(:error)
  end

  let(:commander) { create(:user, role: "commander") }

  # ---------------------------------------------------------------------------
  # Double-execute prevention via row lock
  # ---------------------------------------------------------------------------
  describe "double-execute prevention" do
    it "prevents executing an already-executed recommendation" do
      rec = create(:recommendation,
                   recommendation_type: "flag_site",
                   status: "executed",
                   tier: "rule",
                   confidence: 0.9,
                   rationale: "Test",
                   expires_at: 2.hours.from_now,
                   reviewed_by_id: commander.id,
                   reviewed_at: 1.hour.ago,
                   affected_entity_type: "site",
                   affected_entity_id: create(:site).id,
                   evidence: [],
                   action_payload: {})

      post "/api/recommendations/#{rec.id}/execute", headers: auth_headers(commander)
      expect(response).to have_http_status(:unprocessable_content)
      body = JSON.parse(response.body)
      expect(body["errors"].first).to include("executed")
    end
  end

  # ---------------------------------------------------------------------------
  # Expired recommendation shows as expired in replay listing
  # ---------------------------------------------------------------------------
  describe "expired recommendation scoping" do
    it "marks expired recommendations correctly via the active scope" do
      site = create(:site)
      expired_rec = create(:recommendation,
                           recommendation_type: "flag_site",
                           status: "pending",
                           tier: "rule",
                           confidence: 0.9,
                           rationale: "Test",
                           expires_at: 1.hour.ago,
                           affected_entity_type: "site",
                           affected_entity_id: site.id,
                           evidence: [],
                           action_payload: {})

      site2 = create(:site)
      active_rec = create(:recommendation,
                          recommendation_type: "flag_site",
                          status: "pending",
                          tier: "rule",
                          confidence: 0.9,
                          rationale: "Test 2",
                          expires_at: 2.hours.from_now,
                          affected_entity_type: "site",
                          affected_entity_id: site2.id,
                          evidence: [],
                          action_payload: {})

      expect(Recommendation.active).to include(active_rec)
      expect(Recommendation.active).not_to include(expired_rec)
      expect(Recommendation.expired).to include(expired_rec)
    end
  end

  # ---------------------------------------------------------------------------
  # Deduplication: duplicate_pending? prevents double-create
  # ---------------------------------------------------------------------------
  describe "recommendation deduplication" do
    it "prevents creating duplicate pending recommendations for same entity" do
      site = create(:site)

      existing = create(:recommendation,
                        recommendation_type: "flag_site",
                        status: "pending",
                        tier: "rule",
                        confidence: 0.9,
                        rationale: "First",
                        expires_at: 2.hours.from_now,
                        affected_entity_type: "site",
                        affected_entity_id: site.id,
                        evidence: [],
                        action_payload: {})

      is_dup = Recommendation.duplicate_pending?(
        type: "flag_site",
        entity_type: "site",
        entity_id: site.id
      )
      expect(is_dup).to be true
    end

    it "allows new recommendation after existing one is closed" do
      site = create(:site)

      existing = create(:recommendation,
                        recommendation_type: "flag_site",
                        status: "rejected",
                        tier: "rule",
                        confidence: 0.9,
                        rationale: "First",
                        expires_at: 2.hours.from_now,
                        reviewed_by_id: commander.id,
                        reviewed_at: 1.hour.ago,
                        affected_entity_type: "site",
                        affected_entity_id: site.id,
                        evidence: [],
                        action_payload: {})

      is_dup = Recommendation.duplicate_pending?(
        type: "flag_site",
        entity_type: "site",
        entity_id: site.id
      )
      expect(is_dup).to be false
    end
  end

  # ---------------------------------------------------------------------------
  # Executor: flag_site idempotency
  # ---------------------------------------------------------------------------
  describe "executor idempotency" do
    it "does not double-flag an already-flagged site" do
      site = create(:site, flagged_at: 1.hour.ago, flag_reason: "Previously flagged")

      rec = create(:recommendation,
                   recommendation_type: "flag_site",
                   status: "accepted",
                   tier: "rule",
                   confidence: 0.9,
                   rationale: "Test",
                   expires_at: 2.hours.from_now,
                   reviewed_by_id: commander.id,
                   reviewed_at: Time.current,
                   affected_entity_type: "site",
                   affected_entity_id: site.id,
                   evidence: [],
                   action_payload: { "site_id" => site.id })

      result = Recommendations::ExecutorService.call(recommendation: rec, user: commander)
      # Should succeed but not change the flag
      expect(result.success).to be true
      expect(site.reload.flag_reason).to eq("Previously flagged")
    end
  end

  private

  def auth_headers(user)
    token = JwtAuthenticatable.encode(sub: user.id, email: user.email, role: user.role)
    { "Authorization" => "Bearer #{token}" }
  end
end
