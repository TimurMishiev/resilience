require "rails_helper"

RSpec.describe ThreatDetection::HoneytokenAlertService do
  let(:user) { create(:user, :commander, email: "ops@resilience.test") }
  let(:site) { create(:site, name: "FOB Crimson", honeytoken: true) }
  let(:request) do
    double(
      "ActionDispatch::Request",
      remote_ip: "203.0.113.42",
      headers:   { "User-Agent" => "BadBot/1.0" },
    )
  end

  describe ".alert!" do
    it "writes a chain-hashed audit event with event_type 'honeytoken.accessed'" do
      expect {
        described_class.alert!(record: site, accessed_by: user, request: request)
      }.to change {
        AuditEvent.where(event_type: "honeytoken.accessed", entity_id: site.id).count
      }.by(1)

      ev = AuditEvent.where(event_type: "honeytoken.accessed", entity_id: site.id).order(:occurred_at).last
      expect(ev.actor).to eq(user.email)
      expect(ev.entity_type).to eq("Site")
      expect(ev.entity_id).to eq(site.id)
      expect(ev.action).to eq("read")
      expect(ev.metadata).to include(
        "ip_address" => "203.0.113.42",
        "user_agent" => "BadBot/1.0",
        "user_role"  => "commander",
        "record_id"  => site.id,
      )
    end

    it "records an OperationalStatus alert under threat_detection / honeytoken_access" do
      described_class.alert!(record: site, accessed_by: user, request: request)

      status = OperationalStatus.find_by(category: "threat_detection", key: "honeytoken_access")
      expect(status).to be_present
      expect(status.payload["status"]).to eq("alert")
      expect(status.payload["record_id"]).to eq(site.id)
      expect(status.payload["record_label"]).to eq("FOB Crimson")
      expect(status.payload["accessed_by_id"]).to eq(user.id)
      expect(status.payload["accessed_by_role"]).to eq("commander")
      expect(status.payload["ip_address"]).to eq("203.0.113.42")
      expect(status.payload["user_agent"]).to eq("BadBot/1.0")
      expect(status.payload["triggered_at"]).to be_present
    end

    it "logs a structured warning line for SIEM ingestion" do
      messages = []
      allow(Rails.logger).to receive(:warn) { |msg| messages << msg }

      described_class.alert!(record: site, accessed_by: user, request: request)

      expect(messages).to include(
        a_string_matching(/honeytoken_accessed.*record_type=Site.*record_id=#{site.id}.*user_id=#{user.id}.*user_role=commander/),
      )
    end

    it "returns an ok Result on success" do
      result = described_class.alert!(record: site, accessed_by: user, request: request)
      expect(result.ok?).to be(true)
      expect(result.error).to be_nil
    end

    it "is non-blocking: never raises out of the request path even when alerting fails" do
      # Force the audit-event write to fail; the service should
      # log the failure but return a non-ok Result rather than
      # raise, so the original request response still completes.
      allow(Audit::EventWriter).to receive(:write).and_raise(RuntimeError, "audit chain locked")
      allow(Rails.logger).to receive(:error)

      result = nil
      expect {
        result = described_class.alert!(record: site, accessed_by: user, request: request)
      }.not_to raise_error

      expect(result.ok?).to be(false)
      expect(result.error).to include("audit chain locked")
      expect(Rails.logger).to have_received(:error)
        .with(a_string_matching(/honeytoken_alert_failed.*audit chain locked/))
    end

    it "tolerates a nil request (e.g. console-driven re-trigger for incident response)" do
      result = described_class.alert!(record: site, accessed_by: user, request: nil)
      expect(result.ok?).to be(true)

      ev = AuditEvent.where(event_type: "honeytoken.accessed").order(:occurred_at).last
      expect(ev.metadata["ip_address"]).to be_nil
      expect(ev.metadata["user_agent"]).to be_nil
    end
  end
end
