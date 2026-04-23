require "rails_helper"

RSpec.describe Recommendations::GenerationJob, type: :job do
  let(:connection) { instance_double(ActiveRecord::ConnectionAdapters::PostgreSQLAdapter) }

  before do
    allow(ActiveRecord::Base).to receive(:connection).and_return(connection)
    # The MT2 per-tenant loop queries Organization.pluck(:id). These tests
    # stub ActiveRecord::Base.connection to intercept advisory-lock calls,
    # which would also break a real Organization.pluck — stub it explicitly
    # and default to empty so the single-tenant fallback path runs.
    allow(Organization).to receive(:pluck).with(:id).and_return([])
    allow(OperationalStatus).to receive(:record!)
  end

  it "skips overlapping runs when the advisory lock is unavailable" do
    allow(connection).to receive(:select_value).with(include("pg_try_advisory_lock")).and_return(false)
    allow(Recommendations::GeneratorService).to receive(:call)

    described_class.new.perform

    expect(Recommendations::GeneratorService).not_to have_received(:call)
    expect(OperationalStatus).to have_received(:record!).with(
      category: "job_health",
      key: "recommendation_generation",
      payload: include(status: "skipped")
    )
  end

  it "records successful generation runs" do
    allow(connection).to receive(:select_value).with(include("pg_try_advisory_lock")).and_return("t")
    allow(connection).to receive(:select_value).with(include("pg_advisory_unlock")).and_return("t")
    allow(Recommendations::GeneratorService).to receive(:call).and_return(
      ServiceResult.success(created: 3, invalid_count: 1)
    )

    described_class.new.perform

    expect(OperationalStatus).to have_received(:record!).with(
      category: "job_health",
      key: "recommendation_generation",
      payload: include(status: "ok", created: 3, invalid_count: 1)
    )
  end

  it "records hard failures and re-raises them" do
    allow(connection).to receive(:select_value).with(include("pg_try_advisory_lock")).and_return("t")
    allow(connection).to receive(:select_value).with(include("pg_advisory_unlock")).and_return("t")
    allow(Recommendations::GeneratorService).to receive(:call).and_raise(RuntimeError, "llm timeout")

    expect { described_class.new.perform }.to raise_error(RuntimeError, "llm timeout")

    expect(OperationalStatus).to have_received(:record!).with(
      category: "job_health",
      key: "recommendation_generation",
      payload: include(status: "error", error_messages: ["RuntimeError: llm timeout"])
    )
  end

  describe "tenant enumeration (MT2)" do
    before do
      allow(connection).to receive(:select_value).with(include("pg_try_advisory_lock")).and_return("t")
      allow(connection).to receive(:select_value).with(include("pg_advisory_unlock")).and_return("t")
    end

    it "runs once unscoped when no organizations exist (single-tenant fallback)" do
      allow(Organization).to receive(:pluck).with(:id).and_return([])
      allow(Recommendations::GeneratorService).to receive(:call).and_return(
        ServiceResult.success(created: 2, invalid_count: 0)
      )

      described_class.new.perform

      expect(Recommendations::GeneratorService).to have_received(:call).with(organization_id: nil).once
      expect(OperationalStatus).to have_received(:record!).with(
        category: "job_health",
        key: "recommendation_generation",
        payload: include(status: "ok", created: 2, invalid_count: 0)
      )
    end

    it "runs once per organization and aggregates counts" do
      org_ids = [SecureRandom.uuid, SecureRandom.uuid]
      allow(Organization).to receive(:pluck).with(:id).and_return(org_ids)
      allow(Recommendations::GeneratorService).to receive(:call).with(organization_id: org_ids[0])
        .and_return(ServiceResult.success(created: 3, invalid_count: 1))
      allow(Recommendations::GeneratorService).to receive(:call).with(organization_id: org_ids[1])
        .and_return(ServiceResult.success(created: 2, invalid_count: 0))

      described_class.new.perform

      expect(Recommendations::GeneratorService).to have_received(:call).with(organization_id: org_ids[0]).once
      expect(Recommendations::GeneratorService).to have_received(:call).with(organization_id: org_ids[1]).once
      expect(OperationalStatus).to have_received(:record!).with(
        category: "job_health",
        key: "recommendation_generation",
        payload: include(status: "ok", created: 5, invalid_count: 1)
      )
    end

    it "continues processing remaining tenants after one tenant fails" do
      org_ids = [SecureRandom.uuid, SecureRandom.uuid]
      allow(Organization).to receive(:pluck).with(:id).and_return(org_ids)
      allow(Recommendations::GeneratorService).to receive(:call).with(organization_id: org_ids[0])
        .and_return(ServiceResult.failure(errors: ["assembler query timed out"], payload: { created: 0, invalid_count: 0 }))
      allow(Recommendations::GeneratorService).to receive(:call).with(organization_id: org_ids[1])
        .and_return(ServiceResult.success(created: 4, invalid_count: 2))

      described_class.new.perform

      expect(Recommendations::GeneratorService).to have_received(:call).with(organization_id: org_ids[1]).once
      expect(OperationalStatus).to have_received(:record!).with(
        category: "job_health",
        key: "recommendation_generation",
        payload: include(
          status: "error",
          created: 4,
          invalid_count: 2,
        )
      )
    end
  end
end
