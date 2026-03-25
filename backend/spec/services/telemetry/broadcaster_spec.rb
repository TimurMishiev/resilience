require "rails_helper"

RSpec.describe Telemetry::Broadcaster do
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
    queue = broadcaster.subscribe

    expect(queue).to be_a(SizedQueue)
    expect(broadcaster.subscriber_count).to eq(1)
  end

  it "evicts slow clients when their queue reaches capacity" do
    queue = broadcaster.subscribe
    described_class::MAX_QUEUE_SIZE.times { |index| queue << { seq: index }.to_json }

    allow(Rails.logger).to receive(:warn)

    broadcaster.publish(asset_id: "asset-1", lat: 1.0, lng: 2.0, battery: 99, speed: 3.0, heading: 45.0, ts: 123)

    expect(Rails.logger).to have_received(:warn).with(/Telemetry.*evicting slow client/)
    expect(broadcaster.subscriber_count).to eq(0)
    expect(queue.closed?).to be(true)
  end
end
