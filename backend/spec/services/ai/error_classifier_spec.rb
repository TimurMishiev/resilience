require "rails_helper"

RSpec.describe Ai::ErrorClassifier do
  describe ".user_message" do
    it "classifies AuthenticationError as misconfigured" do
      error = Anthropic::Errors::AuthenticationError.new(
        url: URI("https://api.anthropic.com/v1/messages"),
        status: 401,
        headers: {},
        body: { type: "error", error: { type: "authentication_error", message: "x-api-key header is required" } },
        request: nil,
        response: nil,
      )
      expect(described_class.user_message(error)).to eq(described_class::MISCONFIGURED_MESSAGE)
      expect(described_class.user_message(error)).to include("misconfigured")
      expect(described_class.user_message(error)).to include("Contact your administrator")
    end

    it "classifies PermissionDeniedError as misconfigured" do
      error = Anthropic::Errors::PermissionDeniedError.new(
        url: URI("https://api.anthropic.com/v1/messages"),
        status: 403,
        headers: {},
        body: { type: "error", error: { type: "permission_error", message: "insufficient permissions" } },
        request: nil,
        response: nil,
      )
      expect(described_class.user_message(error)).to eq(described_class::MISCONFIGURED_MESSAGE)
    end

    it "classifies BadRequestError (e.g. credit balance too low) as unavailable" do
      error = Anthropic::Errors::BadRequestError.new(
        url: URI("https://api.anthropic.com/v1/messages"),
        status: 400,
        headers: {},
        body: { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } },
        request: nil,
        response: nil,
      )
      expect(described_class.user_message(error)).to eq(described_class::UNAVAILABLE_MESSAGE)
      expect(described_class.user_message(error)).to include("unavailable")
      expect(described_class.user_message(error)).to include("Contact your administrator")
    end

    it "classifies APIConnectionError as transient (retry-shortly framing)" do
      error = Anthropic::Errors::APIConnectionError.new(
        message: "connection reset",
        url: URI("https://api.anthropic.com"),
      )
      expect(described_class.user_message(error)).to eq(described_class::TRANSIENT_MESSAGE)
      expect(described_class.user_message(error)).to include("temporarily unavailable")
      expect(described_class.user_message(error)).to include("retry shortly")
    end

    it "classifies RateLimitError as transient" do
      error = Anthropic::Errors::RateLimitError.new(
        url: URI("https://api.anthropic.com/v1/messages"),
        status: 429,
        headers: {},
        body: { type: "error", error: { type: "rate_limit_error", message: "rate limited" } },
        request: nil,
        response: nil,
      )
      expect(described_class.user_message(error)).to eq(described_class::TRANSIENT_MESSAGE)
    end

    it "classifies generic Anthropic::Errors::Error as transient (unknown cause defaults to retry)" do
      generic_error_class = Class.new(Anthropic::Errors::Error)
      error = generic_error_class.new
      expect(described_class.user_message(error)).to eq(described_class::TRANSIENT_MESSAGE)
    end

    it "exposes three distinct user-facing messages so a commander can tell retry from escalate" do
      messages = [
        described_class::MISCONFIGURED_MESSAGE,
        described_class::UNAVAILABLE_MESSAGE,
        described_class::TRANSIENT_MESSAGE,
      ]
      expect(messages.uniq.size).to eq(3)
    end
  end

  describe ".failure_tag" do
    it "tags AuthenticationError as misconfigured" do
      error = Anthropic::Errors::AuthenticationError.new(
        url: URI("https://api.anthropic.com/v1/messages"),
        status: 401,
        headers: {},
        body: { type: "error", error: { type: "authentication_error", message: "bad key" } },
        request: nil,
        response: nil,
      )
      expect(described_class.failure_tag(error)).to eq("misconfigured")
    end

    it "tags BadRequestError as unavailable" do
      error = Anthropic::Errors::BadRequestError.new(
        url: URI("https://api.anthropic.com/v1/messages"),
        status: 400,
        headers: {},
        body: { type: "error", error: { type: "invalid_request_error", message: "credit balance too low" } },
        request: nil,
        response: nil,
      )
      expect(described_class.failure_tag(error)).to eq("unavailable")
    end

    it "tags everything else as transient" do
      error = Anthropic::Errors::APIConnectionError.new(message: "boom", url: URI("https://api.anthropic.com"))
      expect(described_class.failure_tag(error)).to eq("transient")
    end
  end
end
