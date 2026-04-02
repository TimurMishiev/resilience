require "rails_helper"

RSpec.describe Realtime::PostgresRelay, type: :service do
  let(:connection) { instance_double(PG::Connection, exec: true, close: true) }

  it "records heartbeat status while listening for notifications" do
    allow(described_class).to receive(:build_listener_connection).and_return(connection)
    allow(Realtime::RelayHealthRegistry).to receive(:record_heartbeat)
    allow(connection).to receive(:wait_for_notify) do |_timeout, &block|
      block.call("signals", 123, { id: "sig-1" }.to_json)
      sleep 0.01
    end

    thread = described_class.listen(channel: "signals", logger_prefix: "Signals") { |_payload| nil }

    sleep 0.05

    expect(Realtime::RelayHealthRegistry).to have_received(:record_heartbeat).at_least(:once)
  ensure
    thread&.kill
    thread&.join(1)
  end

  it "records relay errors when the listener connection fails" do
    error = PG::Error.new("db down")
    allow(described_class).to receive(:build_listener_connection).and_return(connection)
    allow(connection).to receive(:wait_for_notify).and_raise(error)
    allow(Realtime::RelayHealthRegistry).to receive(:record_heartbeat)
    allow(Realtime::RelayHealthRegistry).to receive(:record_error)

    thread = described_class.listen(channel: "telemetry", logger_prefix: "Telemetry") { |_payload| nil }

    sleep 0.05

    expect(Realtime::RelayHealthRegistry).to have_received(:record_error).with(
      hash_including(channel: "telemetry", relay: "telemetry", error: error),
    )
  ensure
    thread&.kill
    thread&.join(1)
  end
end
