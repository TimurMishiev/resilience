require "rails_helper"

RSpec.describe Sse::Broadcaster do
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
      .with(include("[SSE] evict_slow_client", "client=#{queue.object_id}", "event=task_updated", "queue_size=500", "queue_capacity=500", "subscribers=1"))
  end
end
