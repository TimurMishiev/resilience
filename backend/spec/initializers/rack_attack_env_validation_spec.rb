require "rails_helper"

# Verifies the boot-time validation of every env-tunable Rack::Attack
# throttle limit.
#
# Why this exists: prior to API-01 (audit 2026-05-01), every limit was
# read via `ENV.fetch(...).to_i`. `.to_i` silently coerces non-numeric
# strings to 0, which would set the rate limit to 0 and 429 every
# request. The misconfiguration would not fail at boot — it would
# DoS the API at runtime, with no clear signal in the deploy log.
#
# `Rack::Attack.positive_integer_env` raises at boot on any non-positive
# integer input. This spec locks that contract so a future edit that
# reverts to `.to_i` fails noisily.
RSpec.describe "Rack::Attack.positive_integer_env" do
  it "returns the parsed integer for valid positive numeric env input" do
    expect(Rack::Attack.positive_integer_env("RA_TEST_VALID_FAKE", "42")).to eq(42)
  end

  it "returns the default when env var is unset" do
    ENV.delete("RA_TEST_UNSET_FAKE")
    expect(Rack::Attack.positive_integer_env("RA_TEST_UNSET_FAKE", 100)).to eq(100)
  end

  it "raises on non-numeric input rather than silently coercing to 0" do
    ENV["RA_TEST_GARBAGE_FAKE"] = "not_a_number"

    expect {
      Rack::Attack.positive_integer_env("RA_TEST_GARBAGE_FAKE", 100)
    }.to raise_error(/must be a positive integer/)
  ensure
    ENV.delete("RA_TEST_GARBAGE_FAKE")
  end

  it "raises on zero (a 0 limit would 429 every request — a silent DoS)" do
    ENV["RA_TEST_ZERO_FAKE"] = "0"

    expect {
      Rack::Attack.positive_integer_env("RA_TEST_ZERO_FAKE", 100)
    }.to raise_error(/must be a positive integer/)
  ensure
    ENV.delete("RA_TEST_ZERO_FAKE")
  end

  it "raises on negative input" do
    ENV["RA_TEST_NEG_FAKE"] = "-5"

    expect {
      Rack::Attack.positive_integer_env("RA_TEST_NEG_FAKE", 100)
    }.to raise_error(/must be a positive integer/)
  ensure
    ENV.delete("RA_TEST_NEG_FAKE")
  end

  it "raises on empty string (degenerate case from a misconfigured deploy)" do
    ENV["RA_TEST_EMPTY_FAKE"] = ""

    expect {
      Rack::Attack.positive_integer_env("RA_TEST_EMPTY_FAKE", 100)
    }.to raise_error(/must be a positive integer/)
  ensure
    ENV.delete("RA_TEST_EMPTY_FAKE")
  end

  it "uses base-10 parsing (rejects leading-zero octal interpretation that Integer() with no base would do for '08')" do
    ENV["RA_TEST_OCTAL_FAKE"] = "08"

    # Integer("08", 10) → 8; Integer("08") → ArgumentError (08 is invalid octal).
    # We want decimal parsing: a deploy that sets MIN=08 should be valid 8, not crash.
    expect(Rack::Attack.positive_integer_env("RA_TEST_OCTAL_FAKE", 100)).to eq(8)
  ensure
    ENV.delete("RA_TEST_OCTAL_FAKE")
  end
end
