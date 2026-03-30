require "rails_helper"

RSpec.describe Telemetry::Broadcaster do
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
      .with(include("[Telemetry] subscribe", "client=#{queue.object_id}", "subscribers=1", "queue_capacity=200"))
  end

  it "unsubscribes clients, closes their queue, and logs structured context" do
    allow(Rails.logger).to receive(:info)

    queue = broadcaster.subscribe
    broadcaster.unsubscribe(queue)

    expect(queue.closed?).to be(true)
    expect(broadcaster.subscriber_count).to eq(0)
    expect(Rails.logger).to have_received(:info)
      .with(include("[Telemetry] unsubscribe", "client=#{queue.object_id}", "subscribers=0", "queue_closed=true"))
  end

  it "evicts slow clients when their queue reaches capacity" do
    queue = broadcaster.subscribe
    described_class::MAX_QUEUE_SIZE.times { |index| queue << { seq: index }.to_json }

    allow(Rails.logger).to receive(:warn)

    broadcaster.publish(asset_id: "asset-1", lat: 1.0, lng: 2.0, battery: 99, speed: 3.0, heading: 45.0, ts: 123)

    expect(Rails.logger).to have_received(:warn)
      .with(include("[Telemetry] evict_slow_client", "client=#{queue.object_id}", "queue_size=200", "queue_capacity=200", "snapshot_subscribers=1"))
    expect(broadcaster.subscriber_count).to eq(0)
    expect(queue.closed?).to be(true)
  end

  it "publishes telemetry readings through the relay" do
    broadcaster.publish(asset_id: "asset-1", lat: 1.0, lng: 2.0, battery: 99, speed: 3.0, heading: 45.0, ts: 123)

    expect(Realtime::PostgresRelay).to have_received(:publish).with(
      channel: described_class::RELAY_CHANNEL,
      payload: include('"reading":{"asset_id":"asset-1"')
    )
  end

  it "delivers remote telemetry relay payloads to local subscribers" do
    queue = broadcaster.subscribe

    broadcaster.send(
      :handle_relay_payload,
      { origin: "remote-process", reading: { asset_id: "asset-9", lat: 1.0, lng: 2.0, battery: 80, speed: 4.0, heading: 90.0, ts: 456 } }.to_json
    )

    expect(queue.size).to eq(1)
    payload = JSON.parse(queue.pop)
    expect(payload["asset_id"]).to eq("asset-9")
    expect(payload["battery"]).to eq(80)
  end
end
