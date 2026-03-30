require "rails_helper"

RSpec.describe Recommendations::GenerationJob, type: :job do
  let(:connection) { instance_double(ActiveRecord::ConnectionAdapters::PostgreSQLAdapter) }

  before do
    allow(ActiveRecord::Base).to receive(:connection).and_return(connection)
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
end
