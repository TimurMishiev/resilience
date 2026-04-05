# frozen_string_literal: true

require "rails_helper"

RSpec.describe Exports::BatchService do
  let(:site)    { create(:site) }
  let!(:signal) { create(:external_signal, occurred_at: 1.day.ago) }
  let!(:task)   { create(:task, site: site, created_at: 1.day.ago) }

  describe "#call" do
    context "with CSV format" do
      it "returns CSV with correct headers for signals" do
        result = described_class.call(scope: ExternalSignal.all, entity_type: "signals", format: "csv")

        expect(result).to be_success
        lines = result.data.lines
        expect(lines.first.strip).to eq("ID,Source,Type,Latitude,Longitude,Magnitude,OccurredAt,ExternalID")
        expect(lines.size).to eq(2) # header + 1 record
      end

      it "returns CSV with correct headers for tasks" do
        result = described_class.call(scope: Task.all, entity_type: "tasks", format: "csv")

        expect(result).to be_success
        lines = result.data.lines
        expect(lines.first).to include("ID,Title,Description,Priority,WorkflowStatus")
        expect(lines.size).to eq(2)
      end

      it "returns CSV with correct headers for incidents" do
        incident = create(:incident, site: site)
        result = described_class.call(scope: Incident.all, entity_type: "incidents", format: "csv")

        expect(result).to be_success
        lines = result.data.lines
        expect(lines.first).to include("ID,Title,Status,Severity")
        expect(lines.size).to eq(2)
      end

      it "returns CSV with correct headers for audit_events" do
        create(:audit_event)
        result = described_class.call(scope: AuditEvent.all, entity_type: "audit_events", format: "csv")

        expect(result).to be_success
        lines = result.data.lines
        expect(lines.first).to include("ID,Actor,EntityType,EntityID")
        expect(lines.size).to eq(2)
      end

      it "returns CSV with correct headers for sites" do
        result = described_class.call(scope: Site.all, entity_type: "sites", format: "csv")

        expect(result).to be_success
        lines = result.data.lines
        expect(lines.first).to include("ID,Name,Latitude,Longitude,Status")
        expect(lines.size).to eq(2) # header + 1 site
      end
    end

    context "with JSON format" do
      it "returns structured JSON with metadata" do
        result = described_class.call(scope: ExternalSignal.all, entity_type: "signals", format: "json")

        expect(result).to be_success
        parsed = JSON.parse(result.data)
        expect(parsed["entity_type"]).to eq("signals")
        expect(parsed["count"]).to eq(1)
        expect(parsed["exported_at"]).to be_present
        expect(parsed["records"]).to be_an(Array)
        expect(parsed["records"].first["id"]).to eq(signal.id)
      end

      it "includes all configured columns in each record" do
        result = described_class.call(scope: ExternalSignal.all, entity_type: "signals", format: "json")
        record = JSON.parse(result.data)["records"].first

        %w[id source signal_type lat lng magnitude occurred_at external_id].each do |col|
          expect(record).to have_key(col), "Expected record to have key '#{col}'"
        end
      end
    end

    context "time range filtering" do
      let!(:old_signal) { create(:external_signal, occurred_at: 10.days.ago) }
      let!(:new_signal) { create(:external_signal, occurred_at: 1.hour.ago) }

      it "filters with from parameter" do
        result = described_class.call(
          scope: ExternalSignal.all, entity_type: "signals", format: "json",
          from: 2.days.ago
        )

        records = JSON.parse(result.data)["records"]
        ids = records.map { |r| r["id"] }
        expect(ids).to include(new_signal.id)
        expect(ids).not_to include(old_signal.id)
      end

      it "filters with to parameter" do
        result = described_class.call(
          scope: ExternalSignal.all, entity_type: "signals", format: "json",
          to: 5.days.ago
        )

        records = JSON.parse(result.data)["records"]
        ids = records.map { |r| r["id"] }
        expect(ids).to include(old_signal.id)
        expect(ids).not_to include(new_signal.id)
      end

      it "filters with both from and to" do
        mid_signal = create(:external_signal, occurred_at: 3.days.ago)
        result = described_class.call(
          scope: ExternalSignal.all, entity_type: "signals", format: "json",
          from: 5.days.ago, to: 2.days.ago
        )

        records = JSON.parse(result.data)["records"]
        ids = records.map { |r| r["id"] }
        expect(ids).to include(mid_signal.id)
        expect(ids).not_to include(old_signal.id)
        expect(ids).not_to include(new_signal.id)
      end
    end

    context "row cap enforcement" do
      it "respects MAX_ROWS limit" do
        stub_const("Exports::BatchService::MAX_ROWS", 2)
        create_list(:external_signal, 4)

        result = described_class.call(scope: ExternalSignal.all, entity_type: "signals", format: "json")

        expect(result).to be_success
        expect(result.count).to eq(2)
      end
    end

    context "result metadata" do
      it "includes filename with timestamp and format" do
        result = described_class.call(scope: ExternalSignal.all, entity_type: "signals", format: "csv")

        expect(result.filename).to match(/\Asignals-\d{8}-\d{4}\.csv\z/)
      end

      it "includes record count" do
        create(:external_signal)
        result = described_class.call(scope: ExternalSignal.all, entity_type: "signals", format: "json")

        expect(result.count).to eq(ExternalSignal.count)
      end
    end

    context "error handling" do
      it "rejects unsupported entity type" do
        result = described_class.call(scope: ExternalSignal.all, entity_type: "widgets", format: "csv")

        expect(result).not_to be_success
        expect(result.errors).to include(match(/Unsupported entity type/))
      end

      it "rejects unsupported format" do
        result = described_class.call(scope: ExternalSignal.all, entity_type: "signals", format: "xml")

        expect(result).not_to be_success
        expect(result.errors).to include(match(/Unsupported format/))
      end
    end

    context "ordering" do
      it "returns signals ordered by occurred_at desc" do
        old = create(:external_signal, occurred_at: 5.days.ago)
        recent = create(:external_signal, occurred_at: 1.minute.ago)

        result = described_class.call(scope: ExternalSignal.all, entity_type: "signals", format: "json")
        ids = JSON.parse(result.data)["records"].map { |r| r["id"] }

        expect(ids.index(recent.id)).to be < ids.index(old.id)
      end
    end
  end
end
