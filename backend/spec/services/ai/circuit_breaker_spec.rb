require "rails_helper"

RSpec.describe Ai::CircuitBreaker, type: :service do
  include ActiveSupport::Testing::TimeHelpers

  let(:service) { "summary" }

  before do
    Rails.cache.clear
  end

  after do
    Rails.cache.clear
  end

  it "opens after the configured failure threshold" do
    (described_class::FAILURE_THRESHOLD - 1).times do
      described_class.record_failure(service: service)
      expect(described_class.open?(service: service)).to be(false)
    end

    described_class.record_failure(service: service)

    expect(described_class.open?(service: service)).to be(true)
  end

  it "resets on success" do
    described_class::FAILURE_THRESHOLD.times { described_class.record_failure(service: service) }
    expect(described_class.open?(service: service)).to be(true)

    described_class.record_success(service: service)

    expect(described_class.open?(service: service)).to be(false)
  end

  it "auto-closes after the open window elapses" do
    travel_to(Time.zone.parse("2026-04-02T12:00:00Z")) do
      described_class::FAILURE_THRESHOLD.times { described_class.record_failure(service: service) }
      expect(described_class.open?(service: service)).to be(true)
    end

    travel_to(Time.zone.parse("2026-04-02T12:03:00Z")) do
      expect(described_class.open?(service: service)).to be(false)
    end
  end
end
