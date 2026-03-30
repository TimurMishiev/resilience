require "rails_helper"

RSpec.describe Observability do
  let(:scope) { double("SentryScope", set_tags: nil, set_extras: nil, :fingerprint= => nil) }

  before do
    described_class.reset_throttle_state!
  end

  after do
    described_class.reset_throttle_state!
  end

  it "does nothing when Sentry is not initialized" do
    allow(Sentry).to receive(:initialized?).and_return(false)
    allow(Sentry).to receive(:capture_exception)

    described_class.capture_exception(RuntimeError.new("boom"))

    expect(Sentry).not_to have_received(:capture_exception)
  end

  it "captures exceptions with scope tags, extras, and fingerprints" do
    error = RuntimeError.new("relay broke")

    allow(Sentry).to receive(:initialized?).and_return(true)
    allow(Sentry).to receive(:with_scope).and_yield(scope)
    allow(Sentry).to receive(:capture_exception)

    described_class.capture_exception(
      error,
      tags: { component: "postgres_relay" },
      extra: { channel: "resilience_sse_events" },
      fingerprint: ["relay", "postgres_relay"]
    )

    expect(scope).to have_received(:set_tags).with("component" => "postgres_relay")
    expect(scope).to have_received(:set_extras).with("channel" => "resilience_sse_events")
    expect(scope).to have_received(:fingerprint=).with(["relay", "postgres_relay"])
    expect(Sentry).to have_received(:capture_exception).with(error)
  end

  it "throttles duplicate exception captures by throttle key" do
    allow(Sentry).to receive(:initialized?).and_return(true)
    allow(Sentry).to receive(:with_scope).and_yield(scope)
    allow(Sentry).to receive(:capture_exception)

    2.times do
      described_class.capture_exception(
        RuntimeError.new("db down"),
        throttle_key: "postgres_relay:db_down",
        throttle_seconds: 60
      )
    end

    expect(Sentry).to have_received(:capture_exception).once
  end

  it "captures messages when Sentry is initialized" do
    allow(Sentry).to receive(:initialized?).and_return(true)
    allow(Sentry).to receive(:with_scope).and_yield(scope)
    allow(Sentry).to receive(:capture_message)

    described_class.capture_message(
      "[OpenSkyFeed] critical soft failure",
      tags: { component: "feed_ingestion" },
      extra: { consecutive_errors: 10 },
      level: :warning
    )

    expect(scope).to have_received(:set_tags).with("component" => "feed_ingestion")
    expect(scope).to have_received(:set_extras).with("consecutive_errors" => 10)
    expect(Sentry).to have_received(:capture_message).with("[OpenSkyFeed] critical soft failure", level: :warning)
  end
end
