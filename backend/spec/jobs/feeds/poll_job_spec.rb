require "rails_helper"

RSpec.describe Feeds::PollJob, type: :job do
  before do
    allow(Rails.logger).to receive(:info)
    allow(Rails.logger).to receive(:warn)
    allow(Rails.logger).to receive(:error)
  end

  describe "#perform" do
    it "dispatches to the correct ingestion service" do
      result = ServiceResult.success(ingested: 5, feed_health: {})
      expect(Feeds::OpenSkyIngestionService).to receive(:call).and_return(result)

      described_class.new.perform("opensky")
    end

    it "dispatches usgs to UsgsSeismicIngestionService" do
      result = ServiceResult.success(ingested: 2, feed_health: {})
      expect(Feeds::UsgsSeismicIngestionService).to receive(:call).and_return(result)

      described_class.new.perform("usgs")
    end

    it "dispatches gdacs to GdacsIngestionService" do
      result = ServiceResult.success(ingested: 0, feed_health: {})
      expect(Feeds::GdacsIngestionService).to receive(:call).and_return(result)

      described_class.new.perform("gdacs")
    end

    it "silently returns for an unknown feed name" do
      expect { described_class.new.perform("unknown_feed") }.not_to raise_error
    end

    context "when credentials are missing for a gated feed" do
      before do
        allow(ENV).to receive(:[]).and_call_original
        allow(ENV).to receive(:[]).with("AISHUB_USERNAME").and_return(nil)
        allow(ENV).to receive(:fetch).and_call_original
      end

      it "records disabled status and skips execution" do
        expect(Feeds::AisIngestionService).not_to receive(:call)
        expect(Feeds::PollMetrics).to receive(:record_disabled).with(
          feed: "ais",
          errors: ["AISHUB_USERNAME not configured"]
        )

        described_class.new.perform("ais")
      end
    end

    context "when credentials are present for a gated feed" do
      before do
        allow(ENV).to receive(:[]).and_call_original
        allow(ENV).to receive(:[]).with("AISHUB_USERNAME").and_return("test_user")
        allow(ENV).to receive(:fetch).and_call_original
      end

      it "calls the ingestion service" do
        result = ServiceResult.success(ingested: 10, feed_health: {})
        expect(Feeds::AisIngestionService).to receive(:call).and_return(result)

        described_class.new.perform("ais")
      end
    end

    context "when the service returns a failure" do
      it "logs a warning but does not raise" do
        result = ServiceResult.failure(errors: ["API timeout"])
        allow(Feeds::UsgsSeismicIngestionService).to receive(:call).and_return(result)

        expect { described_class.new.perform("usgs") }.not_to raise_error
      end
    end

    it "covers all 7 feeds in the registry" do
      expected = %w[opensky usgs gpsjam ais firms gdacs acled]
      expect(described_class::FEED_REGISTRY.keys).to match_array(expected)
    end
  end
end
