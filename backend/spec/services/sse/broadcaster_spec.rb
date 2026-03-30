require "rails_helper"

RSpec.describe Sse::Broadcaster do
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

  it "logs subscribe context for new clients" do
    allow(Rails.logger).to receive(:info)

    queue = broadcaster.subscribe

    expect(queue).to be_a(Queue)
    expect(broadcaster.subscriber_count).to eq(1)
    expect(Rails.logger).to have_received(:info)
      .with(include("[SSE] subscribe", "client=#{queue.object_id}", "subscribers=1", "queue_capacity=500"))
  end

  it "logs unsubscribe context and closes the queue" do
    allow(Rails.logger).to receive(:info)

    queue = broadcaster.subscribe
    broadcaster.unsubscribe(queue)

    expect(queue.closed?).to be(true)
    expect(broadcaster.subscriber_count).to eq(0)
    expect(Rails.logger).to have_received(:info)
      .with(include("[SSE] unsubscribe", "client=#{queue.object_id}", "subscribers=0", "queue_closed=true"))
  end

  it "evicts slow clients with structured context and closes their queue" do
    allow(Rails.logger).to receive(:warn)

    queue = broadcaster.subscribe
    described_class::MAX_QUEUE_SIZE.times { |index| queue << { seq: index }.to_json }

    broadcaster.publish(event: "task_updated", data: { id: "task-1" })

    expect(queue.closed?).to be(true)
    expect(broadcaster.subscriber_count).to eq(0)
    expect(Rails.logger).to have_received(:warn)
      .with(include("[SSE] evict_slow_client", "client=#{queue.object_id}", "event=task_updated", "queue_size=500", "queue_capacity=500", "snapshot_subscribers=1"))
  end

  it "delivers to healthy clients when another client closes mid-publish" do
    # Simulate a client that disconnects between the snapshot and the push loop.
    # The ClosedQueueError must not abort delivery to subsequent healthy clients.
    healthy = broadcaster.subscribe
    zombie  = broadcaster.subscribe

    zombie.close

    broadcaster.publish(event: "task_updated", data: { id: "task-1" })

    # Healthy client must receive the message.
    expect(healthy.size).to eq(1)
    payload = JSON.parse(healthy.pop)
    expect(payload["event"]).to eq("task_updated")
    expect(payload["data"]["id"]).to eq("task-1")

    # Zombie is removed from the client list after publish.
    expect(broadcaster.subscriber_count).to eq(1)
  end

  it "removes all errored and evicted clients atomically after publish" do
    healthy = broadcaster.subscribe
    slow    = broadcaster.subscribe
    described_class::MAX_QUEUE_SIZE.times { |i| slow << { seq: i }.to_json }

    allow(Rails.logger).to receive(:warn)

    broadcaster.publish(event: "signal_fired", data: {})

    expect(broadcaster.subscriber_count).to eq(1)
    expect(healthy.size).to eq(1)
    expect(slow.closed?).to be(true)
  end

  it "publishes a relay payload for cross-process fanout" do
    broadcaster.publish(event: "task_updated", data: { id: "task-1" })

    expect(Realtime::PostgresRelay).to have_received(:publish).with(
      channel: described_class::RELAY_CHANNEL,
      payload: include('"event":"task_updated"', '"origin":')
    )
  end

  it "delivers remote relay payloads from other processes" do
    queue = broadcaster.subscribe

    broadcaster.send(
      :handle_relay_payload,
      { origin: "remote-process", event: "task_updated", data: { id: "task-9" } }.to_json
    )

    expect(queue.size).to eq(1)
    payload = JSON.parse(queue.pop)
    expect(payload["event"]).to eq("task_updated")
    expect(payload["data"]["id"]).to eq("task-9")
  end

  it "ignores relay payloads that originated from the same process" do
    queue = broadcaster.subscribe

    broadcaster.send(
      :handle_relay_payload,
      { origin: broadcaster.instance_variable_get(:@relay_instance_id), event: "task_updated", data: { id: "task-9" } }.to_json
    )

    expect(queue.size).to eq(0)
  end
end
