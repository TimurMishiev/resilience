require "rails_helper"

RSpec.describe Ai::SummaryService, type: :service do
  # Stub Anthropic client throughout — we never hit the real API in specs.
  let(:fake_response) do
    double("anthropic_response",
      content: [ double("block", text: '{"summary":"Test summary.","citations":[]}') ]
    )
  end

  let(:fake_messages) { double("messages", create: fake_response) }
  let(:fake_client)   { double("anthropic_client", messages: fake_messages) }

  before do
    stub_const("ENV", ENV.to_h.merge("ANTHROPIC_API_KEY" => "test_key_for_specs"))
    allow(Anthropic::Client).to receive(:new).and_return(fake_client)
  end

  let(:site) { create(:site, latitude: 26.5, longitude: 56.2) }

  # ── valid summary types ────────────────────────────────────────────────────

  describe "summary_type validation" do
    # Seed one audit event so the service doesn't hit the "no data" guard
    before do
      create(:audit_event,
             entity_type: "Site", entity_id: site.id,
             event_type:  "site_status_changed", occurred_at: 1.hour.ago)
    end

    %w[site_activity readiness_change leadership_briefing].each do |type|
      it "accepts #{type}" do
        result = described_class.call(summary_type: type)
        expect(result.success).to be true
      end
    end

    it "rejects unknown summary_type" do
      result = described_class.call(summary_type: "hack_the_planet")
      expect(result.success).to be false
      expect(result.errors.first).to match(/Invalid summary_type/)
    end
  end

  # ── no data guard ─────────────────────────────────────────────────────────

  describe "empty data guard" do
    it "returns failure when no data exists for the given site" do
      isolated_site = create(:site)
      # no tasks, no events, no signals, no matches
      result = described_class.call(summary_type: "site_activity", site_id: isolated_site.id)
      expect(result.success).to be false
      expect(result.errors.first).to match(/No operational data/)
    end
  end

  # ── audit event scoping ────────────────────────────────────────────────────

  describe "audit event scoping" do
    let!(:site_audit) do
      create(:audit_event,
             entity_type: "Site", entity_id: site.id,
             event_type:  "site_status_changed", action: "toggle_status",
             actor:       "commander@test.mil", occurred_at: 2.hours.ago)
    end
    let!(:task)       { create(:task, site: site) }
    let!(:task_audit) do
      create(:audit_event,
             entity_type: "Task", entity_id: task.id,
             event_type:  "task_transitioned", action: "transition",
             actor:       "operator@test.mil", occurred_at: 1.hour.ago)
    end
    let!(:other_site_audit) do
      create(:audit_event,
             entity_type: "Site", entity_id: create(:site).id,
             event_type:  "site_status_changed", actor: "other@test.mil",
             occurred_at: 30.minutes.ago)
    end

    it "includes Site-level audit events for the site" do
      content_sent = nil
      allow(fake_messages).to receive(:create) do |args|
        content_sent = args[:messages].first[:content]
        fake_response
      end

      described_class.call(summary_type: "site_activity", site_id: site.id)
      expect(content_sent).to include(site_audit[:id].to_s)
    end

    it "includes Task audit events for tasks belonging to the site" do
      content_sent = nil
      allow(fake_messages).to receive(:create) do |args|
        content_sent = args[:messages].first[:content]
        fake_response
      end

      described_class.call(summary_type: "site_activity", site_id: site.id)
      expect(content_sent).to include(task_audit[:id].to_s)
    end

    it "excludes audit events for other sites" do
      content_sent = nil
      allow(fake_messages).to receive(:create) do |args|
        content_sent = args[:messages].first[:content]
        fake_response
      end

      described_class.call(summary_type: "site_activity", site_id: site.id)
      expect(content_sent).not_to include(other_site_audit[:id].to_s)
    end
  end

  # ── signal context ─────────────────────────────────────────────────────────

  describe "intelligence signal context" do
    let!(:task) { create(:task, site: site) }
    let!(:_audit) do
      create(:audit_event, entity_type: "Task", entity_id: task.id,
             event_type: "task_transitioned", occurred_at: 1.hour.ago)
    end

    context "with a nearby signal" do
      let!(:near_signal) do
        create(:external_signal,
               lat: 26.6, lng: 56.2,
               signal_type: "gps_jamming", source: "gpsjam",
               occurred_at: 3.hours.ago)
      end

      it "includes signal context in the user message" do
        content_sent = nil
        allow(fake_messages).to receive(:create) do |args|
          content_sent = args[:messages].first[:content]
          fake_response
        end

        described_class.call(summary_type: "site_activity", site_id: site.id)
        expect(content_sent).to include("INTELLIGENCE SIGNALS")
        # signal_type is humanized in the context block ("Gps jamming"); source is uppercased ("GPSJAM")
        expect(content_sent).to include("GPSJAM")
      end
    end

    context "with a conflict_event signal" do
      let!(:conflict_signal) do
        create(:external_signal,
               lat: 26.6, lng: 56.2,
               signal_type: "conflict_event", source: "acled",
               occurred_at: 2.hours.ago,
               raw_payload: {
                 "country"    => "Yemen",
                 "actor1"     => "Houthi Forces",
                 "fatalities" => 12,
                 "event_type" => "Armed Clash"
               })
      end

      it "includes country, actor, and fatalities in the context" do
        content_sent = nil
        allow(fake_messages).to receive(:create) do |args|
          content_sent = args[:messages].first[:content]
          fake_response
        end

        described_class.call(summary_type: "site_activity", site_id: site.id)
        expect(content_sent).to include("Yemen")
        expect(content_sent).to include("Houthi Forces")
        expect(content_sent).to include("fatalities: 12")
      end
    end

    context "with a disaster_alert signal" do
      let!(:disaster_signal) do
        create(:external_signal,
               lat: 26.6, lng: 56.2,
               signal_type: "disaster_alert", source: "gdacs",
               magnitude: 2.5,
               occurred_at: 4.hours.ago,
               raw_payload: {
                 "alert_level"     => "Orange",
                 "event_type_name" => "Earthquake",
                 "severity_text"   => "Moderate shaking expected"
               })
      end

      it "includes alert level, event type, and severity in the context" do
        content_sent = nil
        allow(fake_messages).to receive(:create) do |args|
          content_sent = args[:messages].first[:content]
          fake_response
        end

        described_class.call(summary_type: "site_activity", site_id: site.id)
        expect(content_sent).to include("Orange")
        expect(content_sent).to include("Earthquake")
        expect(content_sent).to include("Moderate shaking")
      end
    end

    context "with no nearby signals" do
      it "reports no signals in context" do
        content_sent = nil
        allow(fake_messages).to receive(:create) do |args|
          content_sent = args[:messages].first[:content]
          fake_response
        end

        described_class.call(summary_type: "site_activity", site_id: site.id)
        expect(content_sent).to include("INTELLIGENCE SIGNALS: (none detected in area)")
      end
    end

    context "without a site_id (global briefing)" do
      it "omits the signal context block" do
        create(:audit_event, entity_type: "Site", entity_id: site.id,
               event_type: "site_status_changed", occurred_at: 1.hour.ago)

        content_sent = nil
        allow(fake_messages).to receive(:create) do |args|
          content_sent = args[:messages].first[:content]
          fake_response
        end

        described_class.call(summary_type: "leadership_briefing")
        expect(content_sent).to include("INTELLIGENCE SIGNALS: (none detected in area)")
      end
    end
  end

  # ── rule fire context ──────────────────────────────────────────────────────

  describe "rule fire context" do
    let!(:task) { create(:task, site: site) }
    let!(:_audit) do
      create(:audit_event, entity_type: "Task", entity_id: task.id,
             event_type: "task_transitioned", occurred_at: 1.hour.ago)
    end

    context "with a recent rule fire for the site" do
      let!(:match) do
        create(:signal_rule_match,
               site:            site,
               confidence:      0.87,
               workflow_status: "unacknowledged",
               fired_at:        30.minutes.ago,
               metadata:        {
                 "distance_km"   => 43.2,
                 "signal_type"   => "gps_jamming",
                 "signal_source" => "gpsjam",
                 "actions_taken" => ["create_task"]
               })
      end

      it "includes rule fire context in the user message" do
        content_sent = nil
        allow(fake_messages).to receive(:create) do |args|
          content_sent = args[:messages].first[:content]
          fake_response
        end

        described_class.call(summary_type: "site_activity", site_id: site.id)
        expect(content_sent).to include("RULE FIRES")
        expect(content_sent).to include("87%")
        expect(content_sent).to include("create_task")
      end
    end

    context "with no recent rule fires" do
      it "reports no rule fires" do
        content_sent = nil
        allow(fake_messages).to receive(:create) do |args|
          content_sent = args[:messages].first[:content]
          fake_response
        end

        described_class.call(summary_type: "site_activity", site_id: site.id)
        expect(content_sent).to include("RULE FIRES: (none in last")
      end
    end
  end

  # ── citation validation ────────────────────────────────────────────────────

  describe "citation validation" do
    let!(:task)  { create(:task, site: site) }
    let!(:audit) do
      create(:audit_event, entity_type: "Task", entity_id: task.id,
             event_type: "task_transitioned", occurred_at: 1.hour.ago)
    end

    it "allows valid audit event IDs as citations" do
      allow(fake_messages).to receive(:create).and_return(
        double("resp", content: [ double("b", text: %({"summary":"ok","citations":["#{audit.id}"]})) ])
      )

      result = described_class.call(summary_type: "site_activity", site_id: site.id)
      expect(result.payload[:citations]).to include(audit.id)
    end

    it "strips hallucinated citation IDs not in the provided context" do
      hallucinated_id = SecureRandom.uuid
      allow(fake_messages).to receive(:create).and_return(
        double("resp", content: [ double("b", text: %({"summary":"ok","citations":["#{hallucinated_id}"]})) ])
      )

      result = described_class.call(summary_type: "site_activity", site_id: site.id)
      expect(result.payload[:citations]).not_to include(hallucinated_id)
    end
  end

  # ── context_counts in response ────────────────────────────────────────────

  describe "context_counts" do
    let!(:task)  { create(:task, site: site) }
    let!(:_audit) do
      create(:audit_event, entity_type: "Task", entity_id: task.id,
             event_type: "task_transitioned", occurred_at: 1.hour.ago)
    end

    it "returns context_counts in the payload" do
      result = described_class.call(summary_type: "site_activity", site_id: site.id)
      expect(result.payload[:context_counts]).to include(
        audit_events: be_a(Integer),
        signals:      be_a(Integer),
        rule_fires:   be_a(Integer)
      )
    end
  end

  # ── error handling ────────────────────────────────────────────────────────

  describe "error handling" do
    let!(:_audit) do
      create(:audit_event, entity_type: "Site", entity_id: site.id,
             event_type: "site_status_changed", occurred_at: 1.hour.ago)
    end

    it "returns failure when the AI returns unparseable JSON" do
      allow(fake_messages).to receive(:create).and_return(
        double("resp", content: [ double("b", text: "not json at all") ])
      )
      result = described_class.call(summary_type: "site_activity", site_id: site.id)
      expect(result.success).to be false
      expect(result.errors.first).to match(/unparseable/)
    end

    it "returns failure when ANTHROPIC_API_KEY is missing" do
      allow(Anthropic::Client).to receive(:new).and_raise(KeyError)
      result = described_class.call(summary_type: "site_activity", site_id: site.id)
      expect(result.success).to be false
      expect(result.errors.first).to match(/ANTHROPIC_API_KEY/)
    end

    it "returns failure when site_id is not found" do
      result = described_class.call(
        summary_type: "site_activity",
        site_id:      "00000000-0000-0000-0000-000000000000"
      )
      expect(result.success).to be false
      expect(result.errors.first).to match(/Site not found/)
    end
  end
end
