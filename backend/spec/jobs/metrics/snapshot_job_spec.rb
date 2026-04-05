require "rails_helper"

RSpec.describe Metrics::SnapshotJob, type: :job do
  let(:job) { described_class.new }

  before { Metrics::Recorder.reset! }

  describe "#perform" do
    it "persists request_latency when samples exist" do
      Metrics::Recorder.record_request(controller: "Api::SitesController", action: "index", duration_ms: 12.5)
      Metrics::Recorder.record_request(controller: "Api::SitesController", action: "index", duration_ms: 25.0)

      job.perform

      status = OperationalStatus.find_by(category: "metrics", key: "request_latency")
      expect(status).to be_present
      endpoints = status.payload["endpoints"]
      expect(endpoints.length).to eq(1)
      expect(endpoints.first["endpoint"]).to eq("Api::SitesController#index")
      expect(endpoints.first["count"]).to eq(2)
    end

    it "persists sse_connections snapshot" do
      job.perform

      status = OperationalStatus.find_by(category: "metrics", key: "sse_connections")
      expect(status).to be_present
      expect(status.payload).to have_key("total")
      expect(status.payload).to have_key("by_stream")
    end

    it "persists feed_lag snapshot" do
      job.perform

      status = OperationalStatus.find_by(category: "metrics", key: "feed_lag")
      expect(status).to be_present
      expect(status.payload).to have_key("feeds")
    end

    it "persists ai_response_times when samples exist" do
      Metrics::Recorder.record_ai_call(service: "Ai::SiteRiskAssessor", duration_ms: 800.0)

      job.perform

      status = OperationalStatus.find_by(category: "metrics", key: "ai_response_times")
      expect(status).to be_present
      services = status.payload["services"]
      expect(services.length).to eq(1)
      expect(services.first["service"]).to eq("Ai::SiteRiskAssessor")
    end

    it "persists circuit_breaker status" do
      job.perform

      status = OperationalStatus.find_by(category: "metrics", key: "ai_circuit_breakers")
      expect(status).to be_present
      expect(status.payload).to have_key("any_open")
    end

    it "clears request samples after snapshot" do
      Metrics::Recorder.record_request(controller: "Api::SitesController", action: "index", duration_ms: 10.0)
      job.perform

      expect(Metrics::Recorder.request_samples).to be_empty
    end

    it "is idempotent — running twice updates same OperationalStatus rows" do
      2.times { job.perform }

      count = OperationalStatus.where(category: "metrics", key: "sse_connections").count
      expect(count).to eq(1)
    end
  end
end
