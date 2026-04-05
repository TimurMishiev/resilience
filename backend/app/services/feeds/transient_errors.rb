# frozen_string_literal: true

module Feeds
  # Raised when a feed endpoint returns an HTTP 5xx status code.
  # Treated as transient so PollJob retries with backoff.
  class TransientHttpError < StandardError; end

  # Network-level errors that represent transient failures worth retrying.
  # When a feed ingestion service encounters one of these, it should re-raise
  # so PollJob's `retry_on` can apply exponential backoff.
  #
  # Parse errors (JSON::ParserError, CSV::MalformedCSVError) and validation
  # errors are NOT transient — retrying the same malformed response is pointless.
  module TransientErrors
    CLASSES = [
      Net::OpenTimeout,
      Net::ReadTimeout,
      Net::WriteTimeout,
      Errno::ECONNREFUSED,
      Errno::ECONNRESET,
      Errno::EHOSTUNREACH,
      Errno::ENETUNREACH,
      Errno::ETIMEDOUT,
      Errno::EPIPE,
      SocketError,
      OpenSSL::SSL::SSLError,
      IOError,
      Feeds::TransientHttpError,
    ].freeze

    # Check whether an exception represents a transient network failure.
    def self.match?(exception)
      CLASSES.any? { |klass| exception.is_a?(klass) }
    end
  end
end
