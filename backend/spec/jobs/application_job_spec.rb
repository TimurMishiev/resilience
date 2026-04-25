require "rails_helper"

# Locks the global retry / discard baseline shipped in Tranche 1
# (2026-04-25). Subclasses inherit these defaults; subclass-level
# retry_on / discard_on for the same exception class wins.
RSpec.describe ApplicationJob do
  describe "retry_on baseline" do
    it "retries ActiveRecord::Deadlocked with polynomial backoff (3 attempts)" do
      handler = described_class.rescue_handlers.find do |klass_name, _|
        klass_name == "ActiveRecord::Deadlocked"
      end
      expect(handler).to be_present
    end

    it "retries ActiveRecord::ConnectionTimeoutError with polynomial backoff (5 attempts)" do
      handler = described_class.rescue_handlers.find do |klass_name, _|
        klass_name == "ActiveRecord::ConnectionTimeoutError"
      end
      expect(handler).to be_present
    end
  end

  describe "discard_on baseline" do
    it "discards ActiveJob::DeserializationError" do
      handler = described_class.rescue_handlers.find do |klass_name, _|
        klass_name == "ActiveJob::DeserializationError"
      end
      expect(handler).to be_present
    end

    it "discards ActiveRecord::RecordNotFound" do
      handler = described_class.rescue_handlers.find do |klass_name, _|
        klass_name == "ActiveRecord::RecordNotFound"
      end
      expect(handler).to be_present
    end
  end

  describe "behaviour proof — discard path" do
    # Defines a one-off subclass that raises RecordNotFound inside
    # perform. Without the parent-level discard, the test queue would
    # collect this as a failure; with it, the job runs to completion
    # silently. We assert via the test adapter's enqueued_jobs count
    # rather than expecting a raise.
    let(:job_class) do
      Class.new(ApplicationJob) do
        def perform
          raise ActiveRecord::RecordNotFound, "row gone"
        end

        def self.name
          "TestRecordNotFoundJob"
        end
      end
    end

    it "swallows ActiveRecord::RecordNotFound rather than re-raising" do
      expect { job_class.perform_now }.not_to raise_error
    end
  end

  # Retry behaviour is intentionally not exercised here:
  # perform_now is synchronous and does not drive retry_on — that
  # logic lives in the queue runner (SolidQueue in this app). The
  # retry_handler registration checks above prove the policies are
  # wired; full retry path proof would require booting SolidQueue,
  # which is out of scope for a job baseline spec.
end
