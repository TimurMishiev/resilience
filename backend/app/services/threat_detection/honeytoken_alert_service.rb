module ThreatDetection
  # Fires when an authenticated user accesses a record flagged as
  # a honeytoken (Tranche 4A, ADR-009 item 7 partial-CLOSED).
  #
  # The threat model:
  #   - A honeytoken is a fake-but-realistic record planted in the
  #     system that NO legitimate operator has any reason to read.
  #   - Any read is therefore one of:
  #       1. An attacker scraping records by ID (data exfiltration)
  #       2. A compromised/curious legitimate user behaving anomalously
  #       3. An automated process that should not be reading entities
  #
  # All three are events worth surfacing to operators. This service
  # records the event in three places, layered for resilience:
  #
  #   1. AuditEvent ("honeytoken.accessed") — the chain-hashed
  #      forensic record per ADR-010. Tamper-evident; preserved
  #      across rotations.
  #   2. OperationalStatus ("threat_detection",
  #      "honeytoken_access") — the operator-dashboard-visible
  #      status row. Latest-wins (upsert), so the dashboard always
  #      shows the most recent honeytoken hit; older hits live in
  #      audit_events for historical investigation.
  #   3. Rails.logger.warn — structured log line for SIEM ingestion
  #      or grep-based forensics.
  #
  # The service is deliberately non-blocking: it never raises out
  # of the request path. A failed alert is logged but the original
  # request response still completes — better to serve a possibly-
  # exfiltrated record than to leak the existence of a honeytoken
  # via a 500 error.
  class HoneytokenAlertService
    CATEGORY = "threat_detection"
    KEY      = "honeytoken_access"

    Result = Struct.new(:ok?, :error, keyword_init: true)

    class << self
      def alert!(record:, accessed_by:, request: nil)
        ip         = request&.remote_ip
        user_agent = request&.headers&.fetch("User-Agent", nil)

        emit_audit_event(record: record, accessed_by: accessed_by, ip: ip, user_agent: user_agent)
        record_operational_status(record: record, accessed_by: accessed_by, ip: ip, user_agent: user_agent)
        Rails.logger.warn(format_log_line(record: record, accessed_by: accessed_by, ip: ip, user_agent: user_agent))

        Result.new(ok?: true, error: nil)
      rescue StandardError => e
        # Do not raise out of the request path. A failed alert
        # itself becomes a logged event but we never let an
        # alerting failure degrade the original request.
        Rails.logger.error(
          "[ThreatDetection] honeytoken_alert_failed record_type=#{record.class.name} " \
          "record_id=#{record&.id} error=#{e.class} message=#{e.message}"
        )
        Result.new(ok?: false, error: e.message)
      end

      private

      def emit_audit_event(record:, accessed_by:, ip:, user_agent:)
        Audit::EventWriter.write(
          actor:           accessed_by.email,
          entity_type:     record.class.name,
          entity_id:       record.id,
          event_type:      "honeytoken.accessed",
          action:          "read",
          # No before/after snapshot — read events do not represent
          # a state change. The forensic value lives in actor +
          # entity + occurred_at + metadata.
          after_snapshot:  { "honeytoken_accessed" => true },
          metadata:        {
            "ip_address" => ip,
            "user_agent" => user_agent,
            "record_id"  => record.id,
            "user_role"  => accessed_by.role,
          },
          correlation_id:  SecureRandom.uuid,
        )
      end

      def record_operational_status(record:, accessed_by:, ip:, user_agent:)
        OperationalStatus.record!(
          category: CATEGORY,
          key:      KEY,
          payload:  {
            status:           "alert",
            triggered_at:     Time.current.iso8601(3),
            record_type:      record.class.name,
            record_id:        record.id,
            record_label:     record.try(:name),
            accessed_by_id:   accessed_by.id,
            accessed_by_role: accessed_by.role,
            ip_address:       ip,
            user_agent:       user_agent,
          },
        )
      end

      def format_log_line(record:, accessed_by:, ip:, user_agent:)
        "[ThreatDetection] honeytoken_accessed " \
        "record_type=#{record.class.name} record_id=#{record.id} " \
        "user_id=#{accessed_by.id} user_role=#{accessed_by.role} " \
        "ip=#{ip} ua=#{user_agent.to_s.gsub('"', "'")}"
      end
    end
  end
end
