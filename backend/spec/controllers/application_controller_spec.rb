require "rails_helper"

RSpec.describe ApplicationController do
  subject(:controller) { described_class.new }

  describe "#start_sse_heartbeat" do
    let(:logger) { instance_double(ActiveSupport::Logger, error: nil) }

    before do
      allow(Rails).to receive(:logger).and_return(logger)
    end

    it "logs unexpected heartbeat failures and terminates the thread" do
      heartbeat = controller.send(:start_sse_heartbeat, stream_name: "signals", interval_seconds: 0) do
        raise RuntimeError, "boom"
      end

      expect(heartbeat.join(1)).to eq(heartbeat)
      expect(heartbeat).not_to be_alive
      expect(logger).to have_received(:error)
        .with(include("[SSE][signals] heartbeat failed: RuntimeError: boom"))
        .once
    end

    it "silently stops on client disconnects" do
      heartbeat = controller.send(:start_sse_heartbeat, stream_name: "signals", interval_seconds: 0) do
        raise ActionController::Live::ClientDisconnected
      end

      expect(heartbeat.join(1)).to eq(heartbeat)
      expect(heartbeat).not_to be_alive
      expect(logger).not_to have_received(:error)
    end
  end
end
