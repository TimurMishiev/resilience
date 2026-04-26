# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("lib", "ai", "evals_runner")

RSpec.describe Ai::EvalsRunner, type: :service do
  let(:tmp_dir) { Rails.root.join("tmp", "ai_evals_live_spec_#{SecureRandom.hex(4)}") }
  let!(:user) { create(:user, :commander) }
  let!(:site) { create(:site, name: "Forward Site Bravo") }

  before do
    FileUtils.rm_rf(tmp_dir)
    ENV["AI_EVALS_RESULTS_DIR"] = tmp_dir.to_s
    Metrics::Recorder.reset!
  end

  after do
    ENV.delete("AI_EVALS_RESULTS_DIR")
    FileUtils.rm_rf(tmp_dir)
    Metrics::Recorder.reset!
  end

  def stub_service_success(klass, payload)
    allow(klass).to receive(:call).and_return(ServiceResult.success(payload))
  end

  def stub_service_failure(klass, errors)
    allow(klass).to receive(:call).and_return(ServiceResult.failure(errors: errors))
  end

  describe "#run!" do
    context "when every surface succeeds" do
      before do
        stub_service_success(Ai::FilterService,        filters: { site_id: site.id, priority: "high" })
        stub_service_success(Ai::SignalFilterService,  filters: { signal_type: "gps_jamming" })
        stub_service_success(Ai::OntologyQueryService, nodes: [{ id: "site:1" }, { id: "site:2" }], counts: { node_count: 2, edge_count: 1 })
        stub_service_success(Ai::SummaryService,       summary: "All quiet on the eastern flank.", citations: [])
      end

      it "returns exit code 0 and writes a well-formed JSON artifact" do
        expect(described_class.new.run!).to eq(0)

        artifact = Dir[tmp_dir.join("*.json")].first
        expect(artifact).to be_present, "expected an artifact in #{tmp_dir}"

        payload = JSON.parse(File.read(artifact))
        expect(payload["results"].map { |r| r["surface"] }).to contain_exactly(
          "task_filter", "signal_filter", "ontology_query", "summary",
        )
        expect(payload["results"].map { |r| r["status"] }.uniq).to eq(["success"])
      end
    end

    context "when a service returns a service-level failure" do
      before do
        stub_service_success(Ai::FilterService,        filters: {})
        stub_service_failure(Ai::SignalFilterService,  ["AI service error: 500"])
        stub_service_success(Ai::OntologyQueryService, nodes: [{ id: "site:1" }], counts: { node_count: 1, edge_count: 0 })
        stub_service_success(Ai::SummaryService,       summary: "Brief.", citations: [])
      end

      it "returns exit code 1 and records the surface as a contract_failure" do
        expect(described_class.new.run!).to eq(1)

        artifact = Dir[tmp_dir.join("*.json")].first
        payload = JSON.parse(File.read(artifact))
        signal_row = payload["results"].find { |r| r["surface"] == "signal_filter" }
        expect(signal_row["status"]).to eq("contract_failure")
        expect(signal_row["error"]).to include("AI service error: 500")
      end
    end

    context "when an unexpected exception escapes a service" do
      before do
        stub_service_success(Ai::FilterService,        filters: {})
        allow(Ai::SignalFilterService).to receive(:call).and_raise(RuntimeError, "boom")
        stub_service_success(Ai::OntologyQueryService, nodes: [{ id: "site:1" }], counts: { node_count: 1, edge_count: 0 })
        stub_service_success(Ai::SummaryService,       summary: "Brief.", citations: [])
      end

      it "captures the exception, returns 1, and continues other surfaces" do
        expect(described_class.new.run!).to eq(1)

        artifact = Dir[tmp_dir.join("*.json")].first
        payload = JSON.parse(File.read(artifact))
        signal_row = payload["results"].find { |r| r["surface"] == "signal_filter" }
        expect(signal_row["status"]).to eq("exception")
        expect(signal_row["error"]).to include("RuntimeError: boom")
        # Other surfaces still recorded:
        expect(payload["results"].map { |r| r["surface"] }).to include("ontology_query", "summary")
      end
    end

    context "when GITHUB_STEP_SUMMARY is set" do
      let(:summary_path) { tmp_dir.join("step_summary.md") }

      before do
        FileUtils.mkdir_p(tmp_dir)
        ENV["GITHUB_STEP_SUMMARY"] = summary_path.to_s
        stub_service_success(Ai::FilterService,        filters: {})
        stub_service_success(Ai::SignalFilterService,  filters: {})
        stub_service_success(Ai::OntologyQueryService, nodes: [{ id: "site:1" }], counts: { node_count: 1, edge_count: 0 })
        stub_service_success(Ai::SummaryService,       summary: "OK", citations: [])
      end

      after { ENV.delete("GITHUB_STEP_SUMMARY") }

      it "appends a markdown summary table" do
        described_class.new.run!

        body = File.read(summary_path)
        expect(body).to include("## AI Live Eval")
        expect(body).to include("| task_filter |")
        expect(body).to include("| Service | Calls | Input tokens | Output tokens | Cost (USD) | Models |")
      end
    end
  end
end
