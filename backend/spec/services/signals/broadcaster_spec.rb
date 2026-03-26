require "rails_helper"

RSpec.describe Signals::Broadcaster do
  let(:broadcaster) { described_class.instance }

  before do
    broadcaster.instance_variable_set(:@clients, [])
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
end
