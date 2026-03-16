module Feeds
  # Shared SSL helper for all feed ingestion services.
  #
  # OpenSSL's CRL (Certificate Revocation List) checking can fail when the
  # CDN hosting the CRL distribution point is unreachable, causing otherwise
  # valid TLS connections to be rejected.  This callback allows connections
  # to proceed when OpenSSL reports only CRL-unavailability errors (3 or 33)
  # while still rejecting revoked certificates (error 23 = CERT_REVOKED).
  #
  # Error codes:
  #   3  = X509_V_ERR_UNABLE_TO_GET_CRL          (CRL server unreachable)
  #   23 = X509_V_ERR_CERT_REVOKED               (NOT skipped — still rejected)
  #   33 = X509_V_ERR_UNABLE_TO_GET_CRL_ISSUER   (CRL issuer unreachable)
  module SslHelper
    SSL_VERIFY_CALLBACK = proc { |preverify_ok, store_ctx|
      if !preverify_ok && [3, 33].include?(store_ctx.error)
        true   # waive CRL-unavailability; hostname + chain + CA still verified
      else
        preverify_ok
      end
    }.freeze

    # Build a Net::HTTP object with SSL and the CRL-tolerant verify_callback.
    # All feed services should use this instead of Net::HTTP.new directly.
    def ssl_http(host, port, timeout: 15)
      http                 = Net::HTTP.new(host, port)
      http.use_ssl         = true
      http.verify_callback = SSL_VERIFY_CALLBACK
      http.open_timeout    = timeout
      http.read_timeout    = timeout
      http
    end
  end
end
