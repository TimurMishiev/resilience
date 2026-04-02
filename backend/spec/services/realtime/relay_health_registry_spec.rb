require "rails_helper"

RSpec.describe Realtime::RelayHealthRegistry, type: :service do
  before do
    OperationalStatus.where(category: "relay_health").delete_all
  end

  after do
    OperationalStatus.where(category: "relay_health").delete_all
  end

  it "records relay heartbeat snapshots in operational status" do
    described_class.record_heartbeat(channel: "signals", relay: "signals", last_notify_at: Time.zone.parse("2026-04-02T12:00:00Z"))

    status = OperationalStatus.find_by!(category: "relay_health", key: "signals:signals")
    expect(status.payload).to include(
      "status" => "ok",
      "relay" => "signals",
      "channel" => "signals",
      "last_notify_at" => "2026-04-02T12:00:00.000Z",
    )
    expect(status.payload["heartbeat_expires_at"]).to be_present
  end

  it "records relay errors in operational status" do
    described_class.record_error(channel: "telemetry", relay: "telemetry", error: RuntimeError.new("boom"))

    status = OperationalStatus.find_by!(category: "relay_health", key: "telemetry:telemetry")
    expect(status.payload).to include(
      "status" => "error",
      "relay" => "telemetry",
      "channel" => "telemetry",
      "error_class" => "RuntimeError",
      "error_message" => "boom",
    )
  end
end
