require "rails_helper"

RSpec.describe Ai::OntologyQueryService, type: :service do
  let(:tool_block) { double("tool_block", type: :tool_use, name: described_class::TOOL_NAME, input: tool_input) }
  let(:fake_response) { double("anthropic_response", content: [tool_block]) }
  let(:fake_messages) { double("messages", create: fake_response) }
  let(:fake_client) { double("anthropic_client", messages: fake_messages) }
  let(:user) { create(:user, :commander) }

  before do
    stub_const("ENV", ENV.to_h.merge("ANTHROPIC_API_KEY" => "test_key_for_specs"))
    allow(Anthropic::Client).to receive(:new).and_return(fake_client)
  end

  describe "validation" do
    let(:tool_input) { {} }

    it "rejects a blank query" do
      result = described_class.call(user: user, query: "  ")

      expect(result.success).to be(false)
      expect(result.errors).to include("Query cannot be blank")
    end
  end

  describe "planner hardening" do
    let!(:site) { create(:site, name: "Forward Site Alpha") }
    let(:query) { "show incidents connected to Forward Site Alpha" }
    let(:tool_input) do
      {
        "root_type" => "site",
        "root_name" => "Forward Site Alpha",
        "relations" => ["incidents"],
        "time_window_hours" => 24,
        "limit" => 4,
      }
    end

    it "initializes the Anthropic client with a bounded timeout and no retries" do
      expect(Anthropic::Client).to receive(:new).with(
        hash_including(
          api_key: "test_key_for_specs",
          timeout: Ai::AnthropicClient::DEFAULT_TIMEOUT_SECONDS,
          max_retries: Ai::AnthropicClient::DEFAULT_MAX_RETRIES,
        ),
      ).and_return(fake_client)

      result = described_class.call(user: user, query: query)

      expect(result.success).to be(true)
    end

    it "allows the ontology model to be overridden via environment" do
      stub_const("ENV", ENV.to_h.merge(
        "ANTHROPIC_API_KEY" => "test_key_for_specs",
        "ONTOLOGY_MODEL" => "claude-sonnet-4-5-20250929",
      ))

      expect(fake_messages).to receive(:create).with(
        hash_including(model: "claude-sonnet-4-5-20250929"),
      ).and_return(fake_response)

      result = described_class.call(user: user, query: query)

      expect(result.success).to be(true)
    end

    it "returns a timeout failure and captures observability" do
      timeout_error = Anthropic::Errors::APITimeoutError.new(url: URI("https://api.anthropic.com/v1/messages"))
      allow(fake_messages).to receive(:create).and_raise(timeout_error)

      expect(Rails.logger).to receive(:error).with(a_string_including("Ontology query timed out", "APITimeoutError"))
      expect(Observability).to receive(:capture_exception).with(
        timeout_error,
        hash_including(
          tags: include(service: "ontology_query", failure: "timeout"),
          extra: include(query_length: query.length, as_of_applied: false),
          throttle_key: a_string_including("ontology_query:timeout"),
        ),
      ) do |_exception, kwargs|
        expect(kwargs.fetch(:extra)).not_to have_key(:query)
        expect(kwargs.fetch(:extra)).not_to have_key(:as_of)
      end

      result = described_class.call(user: user, query: query)

      expect(result.success).to be(false)
      expect(result.errors).to eq(["Ontology query timed out"])
    end

    it "logs and captures unexpected planner failures" do
      error = Anthropic::Errors::APIConnectionError.new(message: "planner exploded", url: URI("https://api.anthropic.com"))
      allow(fake_messages).to receive(:create).and_raise(error)

      expect(Rails.logger).to receive(:error).with(a_string_including("AI service error: planner exploded", "Anthropic::Errors::APIConnectionError"))
      expect(Observability).to receive(:capture_exception).with(
        error,
        hash_including(
          tags: include(service: "ontology_query", failure: "error"),
          extra: include(query_length: query.length, as_of_applied: false),
          throttle_key: a_string_including("ontology_query:error"),
        ),
      ) do |_exception, kwargs|
        expect(kwargs.fetch(:extra)).not_to have_key(:query)
        expect(kwargs.fetch(:extra)).not_to have_key(:as_of)
      end

      result = described_class.call(user: user, query: query)

      expect(result.success).to be(false)
      expect(result.errors).to eq(["AI service temporarily unavailable. Please retry shortly."])
    end

    it "rebuilds the catalog context for new instances so fresh entities are visible immediately" do
      first = described_class.new(user: user, query: "first")
      expect(first.send(:catalog_context)).to include("Sites: Forward Site Alpha")

      create(:site, name: "Forward Site Bravo")

      second = described_class.new(user: user, query: "second")
      expect(second.send(:catalog_context)).to include("Forward Site Bravo")
    end

    it "fails closed when the AI circuit breaker is open" do
      allow(Ai::CircuitBreaker).to receive(:open?).with(service: described_class::BREAKER_SERVICE).and_return(true)
      expect(Anthropic::Client).not_to receive(:new)

      result = described_class.call(user: user, query: query)

      expect(result.success).to be(false)
      expect(result.errors).to eq(["AI temporarily unavailable. Please retry shortly."])
    end
  end

  describe "site-root graph execution" do
    let(:area) { create(:area_of_operation, name: "Eastern Littoral") }
    let(:site) do
      create(
        :site,
        name: "Forward Site Alpha",
        area_of_operation: area,
        latitude: 25.2,
        longitude: 56.4,
      )
    end
    let!(:asset) { create(:asset, name: "Guardian 01", home_site: site, status: "available") }
    let!(:task) do
      create(
        :task,
        site: site,
        asset: asset,
        title: "Inspect harbor perimeter",
        priority: "high",
        workflow_status: "triaged",
      )
    end
    let!(:incident) do
      create(
        :incident,
        site: site,
        area_of_operation: area,
        title: "Harbor breach watch",
        severity: "high",
      )
    end
    let!(:signal) do
      create(
        :external_signal,
        signal_type: "gps_jamming",
        source: "gpsjam",
        lat: site.latitude,
        lng: site.longitude,
        occurred_at: 2.hours.ago,
      )
    end
    let!(:rule) { create(:correlation_rule, name: "GPS Jamming Watch") }
    let!(:alert) do
      create(
        :signal_rule_match,
        site: site,
        incident: incident,
        task: task,
        signal: signal,
        correlation_rule: rule,
        fired_at: 90.minutes.ago,
        confidence: 0.88,
        workflow_status: "acknowledged",
      )
    end
    let!(:site_rec) do
      create(
        :recommendation,
        :for_site,
        affected_entity_id: site.id,
        action_payload: { site_id: site.id },
        evidence: [{ type: "site", id: site.id, detail: "risk_score=0.91" }],
      )
    end
    let!(:incident_rec) do
      create(
        :recommendation,
        :for_incident,
        affected_entity_id: incident.id,
        action_payload: { incident_id: incident.id, to_status: "acknowledged" },
        evidence: [{ type: "incident", id: incident.id, detail: "severity=high" }],
      )
    end
    let(:tool_input) do
      {
        "root_type" => "site",
        "root_name" => "Forward Site Alpha",
        "relations" => %w[area incidents tasks assets alerts signals recommendations],
        "time_window_hours" => 48,
        "limit" => 6,
      }
    end

    it "returns a bounded graph rooted on the resolved site" do
      result = described_class.call(user: user, query: "show incidents, alerts, tasks, assets, and recommendations connected to Forward Site Alpha")

      expect(result.success).to be(true)
      expect(result.normalized_query[:root_type]).to eq("site")
      expect(result.normalized_query[:root_id]).to eq(site.id)
      expect(result.normalized_query[:relations]).to include("incidents", "tasks", "alerts", "recommendations")
      expect(result.summary).to include("Forward Site Alpha")

      node_types = result.nodes.map { |node| node[:type] }
      expect(node_types).to include("site", "area_of_operation", "incident", "task", "asset", "alert", "signal", "recommendation")

      edge_relations = result.edges.map { |edge| edge[:relation] }
      expect(edge_relations).to include("site_incident", "site_task", "home_site_asset", "site_alert", "recommendation_target")
      expect(result.counts[:node_count]).to be >= 7
    end
  end

  describe "site-root signal distance refinement" do
    let(:tool_input) { {} }
    let(:site) do
      create(
        :site,
        name: "Equator Site",
        latitude: 0.0,
        longitude: 0.0,
      )
    end
    let!(:near_signal) do
      create(
        :external_signal,
        signal_type: "gps_jamming",
        source: "gpsjam",
        lat: 0.9,
        lng: 0.9,
        occurred_at: 2.hours.ago,
      )
    end
    let!(:second_near_signal) do
      create(
        :external_signal,
        signal_type: "gps_jamming",
        source: "gpsjam",
        lat: 0.8,
        lng: 0.8,
        occurred_at: 150.minutes.ago,
      )
    end
    let!(:bounding_box_only_signals) do
      Array.new(5) do |index|
        create(
          :external_signal,
          signal_type: "gps_jamming",
          source: "gpsjam",
          lat: 1.8,
          lng: 1.8,
          occurred_at: (index + 1).minutes.ago,
        )
      end
    end
    it "keeps scanning past bounding-box-only candidates until it finds the exact-radius matches" do
      service = described_class.new(user: user, query: "show signals near Equator Site")
      result = service.send(:exact_signals_near_site, site, window_start: 24.hours.ago, upper_bound: Time.current, limit: 2)

      expect(result.map(&:id)).to contain_exactly(
        near_signal.id,
        second_near_signal.id,
      )
      expect(result.map(&:id)).not_to include(
        *bounding_box_only_signals.map(&:id),
      )
    end
  end

  describe "historical replay execution" do
    let(:site) do
      create(:site, name: "Replay Site").tap do |record|
        record.update_columns(created_at: 4.hours.ago, updated_at: 4.hours.ago)
      end
    end
    let!(:task) do
      create(
        :task,
        site: site,
        title: "Investigate signal cluster",
        priority: "high",
        workflow_status: "triaged",
      ).tap do |record|
        record.update_columns(created_at: 3.hours.ago, updated_at: 3.hours.ago)
      end
    end
    let!(:recommendation) do
      create(
        :recommendation,
        recommendation_type: "create_task",
        affected_entity_type: "Task",
        affected_entity_id: task.id,
        action_payload: { title: "Follow-up task", site_id: site.id },
      ).tap do |record|
        record.update_columns(created_at: 3.hours.ago, updated_at: 3.hours.ago)
      end
    end
    let(:cutoff) { 1.hour.ago.change(usec: 0) }
    let(:tool_input) do
      {
        "root_type" => "site",
        "root_name" => "Replay Site",
        "relations" => %w[tasks recommendations],
        "time_window_hours" => 72,
        "limit" => 8,
      }
    end

    before do
      create(
        :audit_event,
        entity_type: "Task",
        entity_id: task.id,
        event_type: "task.created",
        before_snapshot: nil,
        after_snapshot: task.attributes.except("updated_at"),
        occurred_at: cutoff - 2.hours,
      )
      create(
        :audit_event,
        entity_type: "Recommendation",
        entity_id: recommendation.id,
        event_type: "recommendation_created",
        before_snapshot: nil,
        after_snapshot: { status: "pending" },
        occurred_at: cutoff - 2.hours,
      )

      task.update!(workflow_status: "resolved", resolved_at: Time.current)
      create(
        :audit_event,
        entity_type: "Task",
        entity_id: task.id,
        event_type: "task.transitioned",
        before_snapshot: { workflow_status: "triaged" },
        after_snapshot: task.attributes.except("updated_at"),
        occurred_at: cutoff + 10.minutes,
      )

      recommendation.accept!(user: create(:user, :commander), reason: "after replay cutoff")
    end

    it "rewinds mutable node state to the replay cutoff" do
      result = described_class.call(user: user,
        query: "show the task and recommendation context around Replay Site",
        as_of: cutoff,
      )

      expect(result.success).to be(true)
      expect(result.normalized_query[:as_of]).to eq(cutoff.iso8601)

      task_node = result.nodes.find { |node| node[:type] == "task" }
      recommendation_node = result.nodes.find { |node| node[:type] == "recommendation" }

      expect(task_node.dig(:metadata, :workflow_status)).to eq("triaged")
      expect(recommendation_node.dig(:metadata, :status)).to eq("pending")
    end

    it "resolves a replay site root even when the site is currently inactive" do
      site.update!(status: "inactive")

      result = described_class.call(user: user,
        query: "show the task and recommendation context around Replay Site",
        as_of: cutoff,
      )

      expect(result.success).to be(true)
      expect(result.normalized_query[:root_id]).to eq(site.id)
    end
  end

  describe "incident-root graph execution" do
    let(:site) { create(:site, name: "Harbor Site Bravo") }
    let(:incident) { create(:incident, site: site, title: "Pier intrusion investigation") }
    let!(:step) do
      create(
        :prosecution_step,
        :executing,
        incident: incident,
        notes: "Patrol craft launched toward pier sector.",
      )
    end
    let(:tool_input) do
      {
        "root_type" => "incident",
        "root_name" => "Pier intrusion investigation",
        "relations" => %w[site prosecution_steps],
        "time_window_hours" => 72,
        "limit" => 4,
      }
    end

    it "returns prosecution steps when incident prosecution is requested" do
      result = described_class.call(user: user, query: "show the prosecution state for pier intrusion investigation")

      expect(result.success).to be(true)
      expect(result.nodes.map { |node| node[:type] }).to include("incident", "site", "prosecution_step")
      expect(result.edges).to include(include(relation: "incident_prosecution_step"))
    end
  end

  describe "asset-root graph execution" do
    let(:site) { create(:site, name: "Forward Site Foxtrot") }
    let(:asset) { create(:asset, name: "Guardian 01", home_site: site, status: "available") }
    let!(:task) do
      create(
        :task,
        site: site,
        asset: asset,
        title: "Escort harbor patrol",
        priority: "high",
        workflow_status: "triaged",
      )
    end
    let!(:recent_recommendation) do
      create(
        :recommendation,
        recommendation_type: "assign_asset",
        affected_entity_type: "Asset",
        affected_entity_id: asset.id,
        action_payload: { task_id: task.id, asset_id: asset.id },
        evidence: [{ type: "asset", id: asset.id, detail: "status=available" }],
      )
    end
    let!(:stale_recommendation) do
      create(
        :recommendation,
        :accepted,
        recommendation_type: "assign_asset",
        affected_entity_type: "Asset",
        affected_entity_id: asset.id,
        action_payload: { task_id: task.id, asset_id: asset.id },
        evidence: [{ type: "asset", id: asset.id, detail: "status=available" }],
      ).tap do |rec|
        rec.update_columns(created_at: 6.days.ago, updated_at: 6.days.ago)
      end
    end
    let(:tool_input) do
      {
        "root_type" => "asset",
        "root_name" => "Guardian 01",
        "relations" => %w[site tasks recommendations],
        "time_window_hours" => 24,
        "limit" => 5,
      }
    end

    it "returns bounded asset context and excludes stale recommendations" do
      result = described_class.call(user: user, query: "show the task, site, and recommendation context around Guardian 01")

      expect(result.success).to be(true)
      expect(result.normalized_query[:root_type]).to eq("asset")
      expect(result.nodes.map { |node| node[:type] }).to include("asset", "site", "task", "recommendation")
      expect(result.nodes.filter { |node| node[:type] == "recommendation" }.map { |node| node[:entity_id] }).to contain_exactly(recent_recommendation.id)
      expect(result.edges).to include(include(relation: "recommendation_target"))
    end
  end

  describe "time window enforcement" do
    let(:site) { create(:site, name: "Harbor Site Charlie") }
    let(:incident) { create(:incident, site: site, title: "Fuel depot intrusion") }
    let!(:recent_signal) do
      create(
        :external_signal,
        signal_type: "gps_jamming",
        source: "gpsjam",
        occurred_at: 6.hours.ago,
      )
    end
    let!(:stale_signal) do
      create(
        :external_signal,
        signal_type: "gps_jamming",
        source: "gpsjam",
        occurred_at: 7.days.ago,
      )
    end
    let!(:recent_alert) do
      create(
        :signal_rule_match,
        :without_task,
        site: site,
        incident: incident,
        signal: recent_signal,
        fired_at: 4.hours.ago,
      )
    end
    let!(:stale_alert) do
      create(
        :signal_rule_match,
        :without_task,
        site: site,
        incident: incident,
        signal: stale_signal,
        fired_at: 8.days.ago,
      )
    end
    let!(:recent_step) do
      create(
        :prosecution_step,
        incident: incident,
        occurred_at: 3.hours.ago,
      )
    end
    let!(:stale_step) do
      create(
        :prosecution_step,
        :concluded,
        incident: incident,
        occurred_at: 9.days.ago,
      )
    end
    let!(:recent_recommendation) do
      create(
        :recommendation,
        :for_incident,
        affected_entity_id: incident.id,
        action_payload: { incident_id: incident.id, to_status: "acknowledged" },
        evidence: [{ type: "incident", id: incident.id, detail: "severity=moderate" }],
      )
    end
    let!(:stale_recommendation) do
      create(
        :recommendation,
        :for_incident,
        :accepted,
        affected_entity_id: incident.id,
        action_payload: { incident_id: incident.id, to_status: "acknowledged" },
        evidence: [{ type: "incident", id: incident.id, detail: "severity=moderate" }],
      ).tap do |rec|
        rec.update_columns(created_at: 10.days.ago, updated_at: 10.days.ago)
      end
    end
    let(:tool_input) do
      {
        "root_type" => "incident",
        "root_name" => "Fuel depot intrusion",
        "relations" => %w[alerts signals recommendations prosecution_steps],
        "time_window_hours" => 24,
        "limit" => 8,
      }
    end

    it "excludes stale time-bound entities outside the requested window" do
      result = described_class.call(user: user, query: "show recent alerts, signals, prosecution steps, and recommendations for fuel depot intrusion")

      expect(result.success).to be(true)

      ids_by_type = result.nodes.group_by { |node| node[:type] }
                               .transform_values { |nodes| nodes.map { |node| node[:entity_id] } }

      expect(ids_by_type["alert"]).to contain_exactly(recent_alert.id)
      expect(ids_by_type["signal"]).to contain_exactly(recent_signal.id)
      expect(ids_by_type["prosecution_step"]).to contain_exactly(recent_step.id)
      expect(ids_by_type["recommendation"]).to contain_exactly(recent_recommendation.id)
    end
  end

  describe "defaults and validation" do
    let!(:site) { create(:site, name: "Forward Site Alpha") }
    let(:tool_input) do
      {
        "root_type" => "site",
        "root_name" => "Forward Site Alpha",
        "relations" => ["not_real"],
        "time_window_hours" => nil,
        "limit" => nil,
      }
    end

    it "falls back to default relations and limits when the tool omits them" do
      result = described_class.call(user: user, query: "show me what is connected to Forward Site Alpha")

      expect(result.success).to be(true)
      expect(result.normalized_query[:relations]).to eq(Ai::OntologyQueryService::RELATIONS_BY_ROOT["site"])
      expect(result.normalized_query[:time_window_hours]).to eq(Ai::OntologyQueryService::DEFAULT_WINDOW_HOURS)
      expect(result.normalized_query[:limit]).to eq(Ai::OntologyQueryService::DEFAULT_LIMIT)
    end
  end

  describe "relation isolation" do
    context "for site-root task queries without assets" do
      let(:site) { create(:site, name: "Harbor Site Delta") }
      let(:asset) { create(:asset, name: "Harbor Patrol 01", home_site: site, status: "available") }
      let!(:task) do
        create(
          :task,
          site: site,
          asset: asset,
          title: "Inspect restricted pier",
        )
      end
      let(:tool_input) do
        {
          "root_type" => "site",
          "root_name" => "Harbor Site Delta",
          "relations" => ["tasks"],
          "time_window_hours" => 24,
          "limit" => 5,
        }
      end

      it "does not include asset nodes when only tasks are requested" do
        result = described_class.call(user: user, query: "show tasks for Harbor Site Delta")

        expect(result.success).to be(true)
        expect(result.normalized_query[:relations]).to eq(["tasks"])
        expect(result.nodes.map { |node| node[:type] }).to contain_exactly("site", "task")
      end
    end

    context "for site-root alert queries" do
      let(:site) { create(:site, name: "Harbor Site Delta") }
      let(:incident) { create(:incident, site: site, title: "Restricted pier approach") }
      let(:task) { create(:task, site: site, title: "Inspect restricted pier") }
      let!(:signal) do
        create(
          :external_signal,
          signal_type: "gps_jamming",
          source: "gpsjam",
          occurred_at: 2.hours.ago,
        )
      end
      let!(:alert) do
        create(
          :signal_rule_match,
          site: site,
          incident: incident,
          task: task,
          signal: signal,
          fired_at: 1.hour.ago,
        )
      end
      let(:tool_input) do
        {
          "root_type" => "site",
          "root_name" => "Harbor Site Delta",
          "relations" => ["alerts"],
          "time_window_hours" => 24,
          "limit" => 5,
        }
      end

      it "does not include unrequested incident or task nodes" do
        result = described_class.call(user: user, query: "show alerts for Harbor Site Delta")

        expect(result.success).to be(true)
        expect(result.normalized_query[:relations]).to eq(["alerts"])
        expect(result.nodes.map { |node| node[:type] }).to contain_exactly("site", "alert")
      end
    end

    context "for task-root alert queries" do
      let(:site) { create(:site, name: "Harbor Site Echo") }
      let(:task) { create(:task, site: site, title: "Inspect quay sector 4") }
      let(:incident) { create(:incident, site: site, title: "Quay intrusion investigation") }
      let!(:signal) do
        create(
          :external_signal,
          signal_type: "gps_jamming",
          source: "gpsjam",
          occurred_at: 90.minutes.ago,
        )
      end
      let!(:alert) do
        create(
          :signal_rule_match,
          task: task,
          site: site,
          incident: incident,
          signal: signal,
          fired_at: 45.minutes.ago,
        )
      end
      let(:tool_input) do
        {
          "root_type" => "task",
          "root_name" => "Inspect quay sector 4",
          "relations" => ["alerts"],
          "time_window_hours" => 24,
          "limit" => 5,
        }
      end

      it "does not include unrequested incident or signal nodes" do
        result = described_class.call(user: user, query: "show alerts for Inspect quay sector 4")

        expect(result.success).to be(true)
        expect(result.normalized_query[:relations]).to eq(["alerts"])
        expect(result.nodes.map { |node| node[:type] }).to contain_exactly("task", "alert")
      end
    end

    context "for incident-root task queries" do
      let(:site) { create(:site, name: "Harbor Site Foxtrot") }
      let(:asset) { create(:asset, name: "Guardian 03", home_site: site, status: "available") }
      let(:incident) { create(:incident, site: site, title: "Pier intrusion investigation") }
      let!(:task) do
        create(
          :task,
          site: site,
          asset: asset,
          title: "Secure pier perimeter",
        )
      end
      let!(:signal) do
        create(
          :external_signal,
          signal_type: "gps_jamming",
          source: "gpsjam",
          occurred_at: 2.hours.ago,
        )
      end
      let!(:alert) do
        create(
          :signal_rule_match,
          task: task,
          site: site,
          incident: incident,
          signal: signal,
          fired_at: 90.minutes.ago,
        )
      end
      let(:tool_input) do
        {
          "root_type" => "incident",
          "root_name" => "Pier intrusion investigation",
          "relations" => ["tasks"],
          "time_window_hours" => 24,
          "limit" => 5,
        }
      end

      it "does not include asset nodes when tasks are requested for an incident" do
        result = described_class.call(user: user, query: "show tasks for Pier intrusion investigation")

        expect(result.success).to be(true)
        expect(result.normalized_query[:relations]).to eq(["tasks"])
        expect(result.nodes.map { |node| node[:type] }).to contain_exactly("incident", "task")
      end
    end
  end

  describe "root resolution" do
    let!(:site_a) { create(:site, name: "Harbor Alpha") }
    let!(:site_b) { create(:site, name: "Harbor Bravo") }
    let(:tool_input) do
      {
        "root_type" => "site",
        "root_name" => "Harbor",
        "relations" => ["incidents"],
        "time_window_hours" => 72,
        "limit" => 4,
      }
    end

    it "returns a clear ambiguity error when multiple roots match" do
      result = described_class.call(user: user, query: "show what is connected to harbor")

      expect(result.success).to be(false)
      expect(result.errors.first).to include("ambiguous")
    end

    it "does not resolve inactive sites that are not present in the active catalog" do
      create(:site, :inactive, name: "Dormant Pier")

      inactive_tool = {
        "root_type" => "site",
        "root_name" => "Dormant Pier",
        "relations" => ["incidents"],
        "time_window_hours" => 72,
        "limit" => 4,
      }

      allow(fake_messages).to receive(:create).and_return(
        double("anthropic_response", content: [double("tool_block", type: :tool_use, name: described_class::TOOL_NAME, input: inactive_tool)]),
      )

      result = described_class.call(user: user, query: "show what is connected to Dormant Pier")

      expect(result.success).to be(false)
      expect(result.errors).to eq(["No site matched 'Dormant Pier'"])
    end
  end

  describe "task-root graph execution" do
    let(:area) { create(:area_of_operation, name: "Northern Approaches") }
    let(:site) { create(:site, name: "Pier Site Kilo", area_of_operation: area) }
    let(:asset) { create(:asset, name: "Patrol Craft 07", home_site: site, status: "available") }
    let!(:task) do
      create(
        :task,
        site:            site,
        asset:           asset,
        title:           "Patrol northern pier",
        priority:        "high",
        workflow_status: "in_progress",
      )
    end
    let!(:incident) { create(:incident, site: site, title: "Pier access breach") }
    let!(:signal) do
      create(
        :external_signal,
        signal_type: "gps_jamming",
        source:      "gpsjam",
        lat:         site.latitude,
        lng:         site.longitude,
        occurred_at: 3.hours.ago,
      )
    end
    let!(:alert) do
      create(
        :signal_rule_match,
        task:     task,
        site:     site,
        incident: incident,
        signal:   signal,
        fired_at: 2.hours.ago,
      )
    end
    let!(:task_rec) do
      create(
        :recommendation,
        recommendation_type:  "create_task",
        affected_entity_type: "Task",
        affected_entity_id:   task.id,
        action_payload:       { task_id: task.id },
        evidence:             [{ type: "task", id: task.id, detail: "workflow=in_progress" }],
      )
    end
    let(:tool_input) do
      {
        "root_type"         => "task",
        "root_name"         => "Patrol northern pier",
        "relations"         => %w[site asset incidents alerts recommendations],
        "time_window_hours" => 24,
        "limit"             => 6,
      }
    end

    it "returns a bounded graph rooted on the resolved task with all requested relations" do
      result = described_class.call(user: user, query: "show site, asset, incidents, alerts, and recommendations for Patrol northern pier")

      expect(result.success).to be(true)
      expect(result.normalized_query[:root_type]).to eq("task")
      expect(result.normalized_query[:root_id]).to eq(task.id)

      node_types = result.nodes.map { |n| n[:type] }
      expect(node_types).to include("task", "site", "asset", "incident", "alert", "recommendation")

      edge_relations = result.edges.map { |e| e[:relation] }
      expect(edge_relations).to include("site_task", "task_asset", "task_alert", "recommendation_target")

      # Incident node must carry alert_count metadata — confirms signal_rule_matches is preloaded
      incident_node = result.nodes.find { |n| n[:type] == "incident" }
      expect(incident_node).not_to be_nil
      expect(incident_node[:metadata][:alert_count]).to be_a(Integer)

      # Deduplication: the same incident appears once across both the alerts→incident
      # path and the direct signal_rule_matches join path
      expect(result.nodes.count { |n| n[:type] == "incident" }).to eq(1)
    end
  end

  describe "area-root graph execution" do
    let!(:area) { create(:area_of_operation, name: "Western Littoral") }
    let!(:site_in_ao) { create(:site, name: "Coastal Site Lima", area_of_operation: area) }
    let!(:incident_in_ao) do
      create(
        :incident,
        site:              site_in_ao,
        area_of_operation: area,
        title:             "Coastal perimeter breach",
      )
    end

    context "with sites and incidents requested" do
      let(:tool_input) do
        {
          "root_type"         => "area_of_operation",
          "root_name"         => "Western Littoral",
          "relations"         => %w[sites incidents],
          "time_window_hours" => 72,
          "limit"             => 6,
        }
      end

      it "returns sites and incidents connected to the area of operation" do
        result = described_class.call(user: user, query: "show sites and incidents in Western Littoral")

        expect(result.success).to be(true)
        expect(result.normalized_query[:root_type]).to eq("area_of_operation")
        expect(result.normalized_query[:root_id]).to eq(area.id)

        node_types = result.nodes.map { |n| n[:type] }
        expect(node_types).to include("area_of_operation", "site", "incident")
        # Recommendations are intentionally excluded from area-root traversal
        expect(node_types).not_to include("recommendation")

        edge_relations = result.edges.map { |e| e[:relation] }
        expect(edge_relations).to include("in_area_of_operation", "incident_area_of_operation")
      end
    end

    context "with only incidents requested (no sites relation)" do
      let!(:unrelated_site) { create(:site, name: "Remote Site November") }
      let(:tool_input) do
        {
          "root_type"         => "area_of_operation",
          "root_name"         => "Western Littoral",
          "relations"         => %w[incidents],
          "time_window_hours" => 72,
          "limit"             => 6,
        }
      end

      it "auto-injects the incident site node even when the sites relation is not requested" do
        result = described_class.call(user: user, query: "show incidents in Western Littoral")

        expect(result.success).to be(true)

        node_types = result.nodes.map { |n| n[:type] }
        # Site is auto-injected from the incident even though sites was not in relations
        expect(node_types).to include("area_of_operation", "incident", "site")

        edge_relations = result.edges.map { |e| e[:relation] }
        expect(edge_relations).to include("incident_area_of_operation", "in_area_of_operation", "site_incident")

        # Only the site belonging to this AO's incident appears — unrelated sites stay out
        site_entity_ids = result.nodes.select { |n| n[:type] == "site" }.map { |n| n[:entity_id] }
        expect(site_entity_ids).to contain_exactly(site_in_ao.id)
        expect(site_entity_ids).not_to include(unrelated_site.id)
      end
    end
  end

  describe "tenant scoping" do
    let(:org) { create(:organization) }
    let(:other_org) { create(:organization) }
    let(:user) { create(:user, :commander, organization: org) }
    let!(:local_site) { create(:site, name: "Forward Site Alpha", organization: org) }
    let!(:foreign_site) { create(:site, name: "Foreign Site Bravo", organization: other_org) }
    let(:tool_input) do
      {
        "root_type" => "site",
        "root_name" => "Foreign Site Bravo",
        "relations" => ["incidents"],
        "time_window_hours" => 24,
        "limit" => 4,
      }
    end

    it "limits the catalog and root resolution to the commander's visible tenant scope" do
      system_prompt = nil
      allow(fake_messages).to receive(:create) do |args|
        system_prompt = args[:system]
        fake_response
      end

      result = described_class.call(user: user, query: "show incidents connected to Foreign Site Bravo")

      expect(result.success).to be(false)
      expect(result.errors.first).to match(/No site matched 'Foreign Site Bravo'/)
      expect(system_prompt).to include("Forward Site Alpha")
      expect(system_prompt).not_to include("Foreign Site Bravo")
    end
  end
end
