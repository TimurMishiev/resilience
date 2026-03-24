require "rails_helper"

RSpec.describe Recommendations::ExecutorService, type: :service do
  let(:commander) { create(:user, :commander) }
  let(:site)      { create(:site) }

  def execute(rec)
    described_class.call(recommendation: rec, user: commander)
  end

  shared_examples "requires accepted status" do |rec_trait|
    it "returns failure when recommendation is not accepted" do
      rec = create(:recommendation, status: "pending", expires_at: 2.hours.from_now)
      result = described_class.call(recommendation: rec, user: commander)
      expect(result).not_to be_success
      expect(result.errors.first).to match(/not accepted/i)
    end
  end

  describe "close_stale_alert / acknowledge_alert" do
    let!(:match) { create(:signal_rule_match, site: site, workflow_status: "unacknowledged", confidence: 0.25) }
    let!(:rec) do
      create(:recommendation,
             status:               "accepted",
             recommendation_type:  "close_stale_alert",
             affected_entity_type: "SignalRuleMatch",
             affected_entity_id:   match.id,
             action_payload:       { "alert_id" => match.id, "to_status" => "closed" },
             expires_at:           2.hours.from_now)
    end

    it "transitions the alert via Alerts::TransitionService" do
      expect(Alerts::TransitionService).to receive(:call).with(
        match:     match,
        to_status: "closed",
        actor:     commander,
        notes:     a_string_including(rec.id),
      ).and_call_original

      result = execute(rec)
      expect(result).to be_success
      expect(match.reload.workflow_status).to eq "closed"
    end

    it "marks the recommendation as executed" do
      execute(rec)
      expect(rec.reload.status).to eq "executed"
      expect(rec.executed_at).to be_present
    end

    it "writes an SSE broadcast (integration: transition emits alert_transitioned)" do
      broadcaster = instance_double(Sse::Broadcaster)
      allow(Sse::Broadcaster).to receive(:instance).and_return(broadcaster)
      allow(broadcaster).to receive(:publish)

      execute(rec)

      expect(broadcaster).to have_received(:publish).with(
        hash_including(event: "alert_transitioned")
      )
    end
  end

  describe "bulk_triage_alerts" do
    let!(:match1) { create(:signal_rule_match, site: site, workflow_status: "unacknowledged", fired_at: 1.hour.ago) }
    let!(:match2) { create(:signal_rule_match, site: site, workflow_status: "unacknowledged", fired_at: 2.hours.ago) }
    let!(:rec) do
      create(:recommendation,
             status:               "accepted",
             recommendation_type:  "bulk_triage_alerts",
             affected_entity_type: "Site",
             affected_entity_id:   site.id,
             action_payload:       { "site_id" => site.id },
             expires_at:           2.hours.from_now)
    end

    it "calls Alerts::TransitionService per alert (not update_all)" do
      expect(Alerts::TransitionService).to receive(:call).twice.and_call_original
      result = execute(rec)
      expect(result).to be_success
      expect(result.succeeded).to eq 2
    end

    it "acknowledges all unacknowledged alerts at the site" do
      execute(rec)
      expect(match1.reload.workflow_status).to eq "acknowledged"
      expect(match2.reload.workflow_status).to eq "acknowledged"
    end
  end

  describe "escalate_incident" do
    let!(:incident) { create(:incident, site: site, status: "open") }
    let!(:rec) do
      create(:recommendation,
             status:               "accepted",
             recommendation_type:  "escalate_incident",
             affected_entity_type: "Incident",
             affected_entity_id:   incident.id,
             action_payload:       { "incident_id" => incident.id, "to_status" => "acknowledged" },
             expires_at:           2.hours.from_now)
    end

    it "transitions the incident and writes an audit event" do
      expect { execute(rec) }.to change(AuditEvent, :count).by(1)
      expect(incident.reload.status).to eq "acknowledged"
      audit = AuditEvent.last
      expect(audit.event_type).to eq "incident_transitioned"
      expect(audit.metadata["recommendation_id"]).to eq rec.id
    end
  end

  describe "create_task" do
    let!(:rec) do
      create(:recommendation,
             status:               "accepted",
             recommendation_type:  "create_task",
             affected_entity_type: "Site",
             affected_entity_id:   site.id,
             action_payload:       { "site_id" => site.id, "title" => "AI-generated task", "priority" => "high" },
             expires_at:           2.hours.from_now)
    end

    it "creates the task via Tasks::CreationService with audit metadata" do
      create(:asset, status: "available")   # ensure pre-flight passes
      expect(Tasks::CreationService).to receive(:call).with(
        params:   hash_including(title: "AI-generated task", priority: "high"),
        actor:    commander,
        metadata: hash_including(recommendation_id: rec.id),
      ).and_call_original

      result = execute(rec)
      expect(result).to be_success
      expect(AuditEvent.where(event_type: "task.created").count).to eq 1
    end

    it "fails pre-flight when no available or assigned assets exist" do
      # Ensure only degraded/offline assets in DB
      Asset.update_all(status: "offline")
      result = execute(rec)
      expect(result).not_to be_success
      expect(result.errors.first).to include("No available or assigned assets")
    end
  end

  describe "flag_site" do
    let!(:rec) do
      create(:recommendation,
             status:               "accepted",
             recommendation_type:  "flag_site",
             affected_entity_type: "Site",
             affected_entity_id:   site.id,
             action_payload:       { "site_id" => site.id },
             expires_at:           2.hours.from_now)
    end

    it "sets flagged_at and writes a site_flagged audit event" do
      expect { execute(rec) }.to change(AuditEvent, :count).by(1)
      expect(site.reload.flagged_at).to be_present
      expect(AuditEvent.last.event_type).to eq "site_flagged"
    end

    it "is idempotent — does not re-flag an already-flagged site" do
      site.update!(flagged_at: 1.hour.ago)
      # Create a second accepted rec for the site (the first one will be executed)
      second_rec = create(:recommendation,
                          status:               "accepted",
                          recommendation_type:  "flag_site",
                          affected_entity_type: "Site",
                          affected_entity_id:   site.id,
                          action_payload:       { "site_id" => site.id },
                          expires_at:           2.hours.from_now)
      expect { execute(second_rec) }.not_to change(AuditEvent, :count)
      expect(second_rec.reload.status).to eq "executed"
    end
  end

  describe "assign_asset" do
    let!(:task)  { create(:task,  site: site, asset_id: nil, priority: "high", workflow_status: "new") }
    let!(:asset) { create(:asset, status: "available") }
    let!(:rec) do
      create(:recommendation,
             status:               "accepted",
             recommendation_type:  "assign_asset",
             affected_entity_type: "Task",
             affected_entity_id:   task.id,
             action_payload:       { "task_id" => task.id, "asset_id" => asset.id },
             expires_at:           2.hours.from_now)
    end

    it "assigns the asset to the task and writes an audit event" do
      expect { execute(rec) }.to change(AuditEvent, :count).by(1)
      expect(task.reload.asset_id).to eq asset.id
      expect(rec.reload.status).to eq "executed"
    end

    it "returns failure when task is not found" do
      rec.update!(action_payload: { "task_id" => "nonexistent", "asset_id" => asset.id })
      result = execute(rec)
      expect(result).not_to be_success
      expect(result.errors.first).to include("Task nonexistent not found")
    end

    it "returns failure when asset is not found" do
      rec.update!(action_payload: { "task_id" => task.id, "asset_id" => "nonexistent" })
      result = execute(rec)
      expect(result).not_to be_success
      expect(result.errors.first).to include("Asset nonexistent not found")
    end
  end
end
