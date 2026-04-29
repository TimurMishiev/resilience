module Ai
  # Translates Anthropic SDK errors into cause-specific user-facing messages
  # so a commander can tell whether to retry, contact an admin about config,
  # or contact an admin about billing.
  #
  # Three buckets:
  #   - misconfigured (auth/permission)  → admin needs to repair the API key
  #                                        or its permissions
  #   - unavailable   (bad request)      → admin needs to investigate;
  #                                        most commonly a billing/credit
  #                                        issue from Anthropic
  #   - transient     (rate / network /  → user retries; circuit breaker
  #                    server / unknown)   handles repeated failures
  #
  # We deliberately do not surface raw `e.message` to the frontend because
  # the Anthropic SDK may include request fragments, token counts, or
  # partial response bodies in error text depending on SDK version.
  module ErrorClassifier
    MISCONFIGURED_MESSAGE = "AI service is misconfigured. Contact your administrator.".freeze
    UNAVAILABLE_MESSAGE   = "AI service is unavailable. Contact your administrator.".freeze
    TRANSIENT_MESSAGE     = "AI service temporarily unavailable. Please retry shortly.".freeze

    MISCONFIGURED_TAG = "misconfigured".freeze
    UNAVAILABLE_TAG   = "unavailable".freeze
    TRANSIENT_TAG     = "transient".freeze

    # Returns the user-facing message string for a rescued Anthropic error.
    def self.user_message(exception)
      case exception
      when Anthropic::Errors::AuthenticationError, Anthropic::Errors::PermissionDeniedError
        MISCONFIGURED_MESSAGE
      when Anthropic::Errors::BadRequestError
        UNAVAILABLE_MESSAGE
      else
        TRANSIENT_MESSAGE
      end
    end

    # Returns a short tag used in observability/log breadcrumbs so we can
    # filter by classification (misconfigured / unavailable / transient).
    def self.failure_tag(exception)
      case exception
      when Anthropic::Errors::AuthenticationError, Anthropic::Errors::PermissionDeniedError
        MISCONFIGURED_TAG
      when Anthropic::Errors::BadRequestError
        UNAVAILABLE_TAG
      else
        TRANSIENT_TAG
      end
    end
  end
end
