require "rails_helper"

RSpec.describe Signals::Broadcaster do
  let(:broadcaster) { described_class.instance }

  before do
    broadcaster.instance_variable_set(:@clients, [])
    broadcaster.instance_variable_set(:@relay_listener, nil)
    allow(Realtime::PostgresRelay).to receive(:publish)
  end

  after do
    broadcaster.instance_variable_get(:@clients).each do |queue|
      queue.close unless queue.closed?
    end
    broadcaster.instance_variable_set(:@clients, [])
  end

  it "subscribes clients with bounded queues" do
    allow(Rails.logger).to receive(:info)

    queue = broadcaster.subscribe

    expect(queue).to be_a(SizedQueue)
    expect(broadcaster.subscriber_count).to eq(1)
    expect(Rails.logger).to have_received(:info)
      .with(include("[Signals] subscribe", "client=#{queue.object_id}", "subscribers=1", "queue_capacity=200"))
  end

  it "unsubscribes clients, closes their queue, and logs structured context" do
    allow(Rails.logger).to receive(:info)

    queue = broadcaster.subscribe
    broadcaster.unsubscribe(queue)

    expect(queue.closed?).to be(true)
    expect(broadcaster.subscriber_count).to eq(0)
    expect(Rails.logger).to have_received(:info)
      .with(include("[Signals] unsubscribe", "client=#{queue.object_id}", "subscribers=0", "queue_closed=true"))
  end

  it "evicts slow clients when their queue reaches capacity" do
    queue = broadcaster.subscribe
    described_class::MAX_QUEUE_SIZE.times { |index| queue << { seq: index }.to_json }

    allow(Rails.logger).to receive(:warn)

    broadcaster.publish(id: "signal-1", signal_type: "disaster_alert")

    expect(Rails.logger).to have_received(:warn)
      .with(include("[Signals] evict_slow_client", "client=#{queue.object_id}", "queue_size=200", "queue_capacity=200", "subscribers=1"))
    expect(broadcaster.subscriber_count).to eq(0)
    expect(queue.closed?).to be(true)
  end

  it "publishes small payloads directly through the relay" do
    broadcaster.publish(id: "signal-1", signal_type: "disaster_alert")

    expect(Realtime::PostgresRelay).to have_received(:publish).with(
      channel: described_class::RELAY_CHANNEL,
      payload: include('"payload":{"id":"signal-1","signal_type":"disaster_alert"}')
    )
  end

  it "falls back to signal_id relay payloads when the payload is too large" do
    oversized_payload = {
      id: "signal-1",
      signal_type: "disaster_alert",
      raw_payload: { body: "x" * 8_000 },
    }

    broadcaster.publish(oversized_payload)

    expect(Realtime::PostgresRelay).to have_received(:publish).with(
      channel: described_class::RELAY_CHANNEL,
      payload: include('"signal_id":"signal-1"')
    )
  end

  it "rebuilds payloads from signal ids received over the relay" do
    queue = broadcaster.subscribe
    signal = create(:external_signal, signal_type: "disaster_alert", raw_payload: { "body" => "ok" })

    broadcaster.send(
      :handle_relay_payload,
      { origin: "remote-process", signal_id: signal.id }.to_json
    )

    expect(queue.size).to eq(1)
    payload = JSON.parse(queue.pop)
    expect(payload["id"]).to eq(signal.id)
    expect(payload["signal_type"]).to eq("disaster_alert")
  end
end
