# frozen_string_literal: true

require "rails_helper"

RSpec.describe Metrics::Recorder, type: :service do
  before { described_class.reset! }
  after  { described_class.reset! }

  describe ".record_request / .request_samples" do
    it "accumulates samples per endpoint" do
      described_class.record_request(controller: "Api::SitesController", action: "index", duration_ms: 12.3)
      described_class.record_request(controller: "Api::SitesController", action: "index", duration_ms: 8.1)
      described_class.record_request(controller: "Api::TasksController", action: "show", duration_ms: 45.0)

      samples = described_class.request_samples
      expect(samples["Api::SitesController#index"]).to eq([12.3, 8.1])
      expect(samples["Api::TasksController#show"]).to eq([45.0])
    end

    it "caps samples at MAX_SAMPLES per endpoint" do
      (described_class::MAX_SAMPLES + 50).times do |i|
        described_class.record_request(controller: "Api::SitesController", action: "index", duration_ms: i.to_f)
      end

      samples = described_class.request_samples
      expect(samples["Api::SitesController#index"].size).to eq(described_class::MAX_SAMPLES)
      expect(samples["Api::SitesController#index"].first).to eq(50.0) # oldest trimmed
    end
  end

  describe ".record_ai_call" do
    it "accumulates AI service timing samples" do
      described_class.record_ai_call(service: "task_filter", duration_ms: 320.5)
      described_class.record_ai_call(service: "task_filter", duration_ms: 450.2)
      described_class.record_ai_call(service: "summary", duration_ms: 800.0)

      # AI samples are private — verify via snapshot! persistence
      described_class.snapshot!
      status = OperationalStatus.find_by(category: "metrics", key: "ai_response_times")
      expect(status).to be_present
      services = status.payload["services"]
      expect(services.map { |s| s["service"] }).to contain_exactly("task_filter", "summary")
    end
  end

  describe ".snapshot!" do
    let!(:user) { create(:user) }

    it "persists request_latency with percentiles" do
      [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].each do |ms|
        described_class.record_request(controller: "Api::SitesController", action: "index", duration_ms: ms.to_f)
      end

      described_class.snapshot!

      status = OperationalStatus.find_by(category: "metrics", key: "request_latency")
      expect(status).to be_present
      endpoint = status.payload["endpoints"].first
      expect(endpoint["endpoint"]).to eq("Api::SitesController#index")
      expect(endpoint["count"]).to eq(10)
      expect(endpoint["p50_ms"]).to be_a(Numeric)
      expect(endpoint["p95_ms"]).to be_a(Numeric)
      expect(endpoint["p99_ms"]).to be_a(Numeric)
      expect(endpoint["max_ms"]).to eq(100.0)
    end

    it "clears request samples after snapshot" do
      described_class.record_request(controller: "Api::SitesController", action: "index", duration_ms: 10.0)
      described_class.snapshot!

      expect(described_class.request_samples).to be_empty
    end

    it "persists sse_connections count" do
      create(:sse_stream_lease, user: user, expires_at: 10.minutes.from_now)
      create(:sse_stream_lease, user: user, expires_at: 10.minutes.from_now, stream_name: "telemetry")

      described_class.snapshot!

      status = OperationalStatus.find_by(category: "metrics", key: "sse_connections")
      expect(status).to be_present
      expect(status.payload["total"]).to eq(2)
      expect(status.payload["by_stream"]).to be_a(Hash)
    end

    it "persists feed_lag from feed_health statuses" do
      OperationalStatus.record!(
        category: "feed_health",
        key: "usgs",
        payload: { "feed" => "usgs", "status" => "ok", "finished_at" => 2.minutes.ago.iso8601, "ingested_count" => 5, "error_count" => 0 }
      )

      described_class.snapshot!

      status = OperationalStatus.find_by(category: "metrics", key: "feed_lag")
      expect(status).to be_present
      feeds = status.payload["feeds"]
      expect(feeds.size).to eq(1)
      expect(feeds.first["feed"]).to eq("usgs")
      expect(feeds.first["lag_seconds"]).to be_within(5).of(120)
    end

    it "persists ai_response_times with percentiles" do
      described_class.record_ai_call(service: "task_filter", duration_ms: 200.0)
      described_class.record_ai_call(service: "task_filter", duration_ms: 400.0)

      described_class.snapshot!

      status = OperationalStatus.find_by(category: "metrics", key: "ai_response_times")
      expect(status).to be_present
      svc = status.payload["services"].find { |s| s["service"] == "task_filter" }
      expect(svc["count"]).to eq(2)
      expect(svc["p50_ms"]).to be_a(Numeric)
      expect(svc["p95_ms"]).to be_a(Numeric)
    end

    it "skips request_latency when no samples exist" do
      described_class.snapshot!
      expect(OperationalStatus.find_by(category: "metrics", key: "request_latency")).to be_nil
    end

    it "skips ai_response_times when no samples exist" do
      described_class.snapshot!
      expect(OperationalStatus.find_by(category: "metrics", key: "ai_response_times")).to be_nil
    end
  end

  describe "thread safety" do
    it "handles concurrent writes without raising" do
      threads = 4.times.map do
        Thread.new do
          50.times do |i|
            described_class.record_request(controller: "Api::SitesController", action: "index", duration_ms: i.to_f)
            described_class.record_ai_call(service: "test", duration_ms: i.to_f)
          end
        end
      end

      expect { threads.each(&:join) }.not_to raise_error

      samples = described_class.request_samples
      expect(samples["Api::SitesController#index"].size).to be_between(1, described_class::MAX_SAMPLES)
    end
  end
end
