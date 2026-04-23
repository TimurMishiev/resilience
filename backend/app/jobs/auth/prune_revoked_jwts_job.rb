module Auth
  # Deletes expired RevokedJwt rows to keep the revocation list bounded.
  #
  # Runs daily via SolidQueue (see config/recurring.yml).
  #
  # RevokedJwt.active filters `expires_at > Time.current`, so expired rows are
  # already unused by the auth path — this job is pure maintenance to prevent
  # unbounded table growth as tokens churn. JWT TTL is 24h (JwtAuthenticatable
  # TTL), so a daily cadence reliably drains the table.
  class PruneRevokedJwtsJob < ApplicationJob
    queue_as :background

    def perform
      deleted = RevokedJwt.where("expires_at <= ?", Time.current).delete_all
      Rails.logger.info "[Auth::PruneRevokedJwts] deleted #{deleted} expired revocation(s)" if deleted.positive?
    end
  end
end
