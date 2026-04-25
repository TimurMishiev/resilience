module Audit
  # Scheduled integrity sweep over every audit_events chain. Recorded
  # against OperationalStatus("job_health", "audit_chain_integrity") so
  # the operator dashboard surfaces a chain break as a degraded job
  # rather than burying it in a log line.
  #
  # Runs daily per config/recurring.yml. The sweep is read-only; chain
  # breaks are *reported*, never auto-repaired — fixing a tampered row
  # is an incident-response decision, not an automatic action.
  class VerifyAllChainsJob < ApplicationJob
    queue_as :background

    def perform
      verifications = Audit::ChainVerifier.verify_all
      breaks        = verifications.reject(&:valid)

      Rails.logger.info(
        "[Audit::VerifyAllChainsJob] verified #{verifications.size} chains, " \
        "#{breaks.size} breaks detected"
      )

      breaks.each do |v|
        Rails.logger.error(
          "[Audit::VerifyAllChainsJob] CHAIN BREAK org=#{v.organization_id || 'global'} " \
          "position=#{v.broken_at} reason=#{v.reason}"
        )
      end

      record_operational_status(verifications: verifications, breaks: breaks)
      verifications
    end

    private

    def record_operational_status(verifications:, breaks:)
      payload = {
        status:        breaks.empty? ? "ok" : "error",
        checked_at:    Time.current.iso8601(3),
        chains:        verifications.size,
        rows_checked:  verifications.sum(&:rows_checked),
        breaks_count:  breaks.size,
      }
      payload[:breaks] = breaks.first(10).map(&:to_h_serialisable) if breaks.any?

      OperationalStatus.record!(
        category: "job_health",
        key:      "audit_chain_integrity",
        payload:  payload
      )
    end
  end
end
