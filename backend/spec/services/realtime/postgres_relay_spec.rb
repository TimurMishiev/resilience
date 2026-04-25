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

  describe ".publish" do
    it "rejects payloads larger than the NOTIFY safety cap and skips the cross-machine relay" do
      # Postgres' NOTIFY hard limit is 8000 bytes; we cap at 7_900 to leave
      # protocol headroom. A payload over the cap must NOT silently call
      # pg_notify (which would raise PG::InvalidParameterValue from deep
      # inside a fire-and-forget code path) — we log loudly and return
      # false so callers can fall back to a different transport if needed.
      oversized = "x" * (described_class::NOTIFY_PAYLOAD_BYTE_LIMIT + 1)

      expect(Rails.logger).to receive(:error).with(/payload too large for NOTIFY/)
      # No DB call should reach the connection.
      expect(ActiveRecord::Base.connection_pool).not_to receive(:with_connection)

      result = described_class.publish(channel: "telemetry", payload: oversized)

      expect(result).to be false
    end

    it "publishes payloads at or below the safety cap" do
      payload = "x" * described_class::NOTIFY_PAYLOAD_BYTE_LIMIT

      stub_conn = instance_double(PG::Connection)
      ar_conn = instance_double(ActiveRecord::ConnectionAdapters::AbstractAdapter, raw_connection: stub_conn)
      allow(ActiveRecord::Base.connection_pool).to receive(:with_connection).and_yield(ar_conn)
      expect(stub_conn).to receive(:exec_params).with(
        "SELECT pg_notify($1, $2)",
        ["telemetry", payload],
      )

      result = described_class.publish(channel: "telemetry", payload: payload)

      expect(result).to be true
    end
  end
end
