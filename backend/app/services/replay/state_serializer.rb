module Replay
  # Centralized replay state reconstruction for entity types that follow the
  # audit-snapshot pattern. Eliminates duplicate replay_states_for_* methods
  # across controllers by providing a single, tested entry point.
  class StateSerializer < ApplicationService
    # Reconstructs historical workflow state for SignalRuleMatch records.
    # Returns { match_id => { workflow_status:, acknowledged_at:, notes:, acknowledged_by: } }
    def self.match_states(matches, as_of:)
      ids = matches.map(&:id)
      snapshots = AuditSnapshotService.call(
        entity_type: "SignalRuleMatch",
        entity_ids: ids,
        as_of: as_of,
      ).snapshots

      acknowledged_by_ids = snapshots.values.filter_map { |s| AuditSnapshotService.value(s, "acknowledged_by_id", default: nil) }.uniq
      emails_by_id = User.where(id: acknowledged_by_ids).pluck(:id, :email).to_h

      matches.each_with_object({}) do |match, states|
        snapshot = snapshots[match.id] || {}
        ack_id = AuditSnapshotService.value(snapshot, "acknowledged_by_id", default: nil)

        states[match.id] = {
          workflow_status: AuditSnapshotService.value(snapshot, "workflow_status", default: "unacknowledged"),
          acknowledged_at: AuditSnapshotService.value(snapshot, "acknowledged_at", default: nil),
          notes:           AuditSnapshotService.value(snapshot, "notes", default: nil),
          acknowledged_by: ack_id.present? ? { id: ack_id, email: emails_by_id[ack_id] }.compact : nil,
        }
      end
    end

    # Reconstructs historical state for Recommendation records.
    # Returns { rec_id => { status:, reviewed_by:, reviewed_at:, review_reason:, executed_at: } }
    def self.recommendation_states(records, as_of:)
      ids = records.map(&:id)
      snapshots = AuditSnapshotService.call(
        entity_type: "Recommendation",
        entity_ids: ids,
        as_of: as_of,
      ).snapshots

      records.each_with_object({}) do |record, states|
        snapshot      = snapshots[record.id] || {}
        replay_status = AuditSnapshotService.value(snapshot, "status", default: "pending")
        replay_status = "expired" if replay_status == "pending" && record.expires_at.present? && record.expires_at <= as_of

        reviewed = %w[accepted rejected deferred executed].include?(replay_status)
        states[record.id] = {
          status: replay_status,
          reviewed_by: reviewed && record.reviewer ? {
            id: record.reviewer.id,
            email: record.reviewer.email,
          } : nil,
          reviewed_at: reviewed && record.reviewed_at.present? && record.reviewed_at <= as_of ? record.reviewed_at : nil,
          review_reason: reviewed ? AuditSnapshotService.value(snapshot, "review_reason", default: record.review_reason) : nil,
          executed_at: replay_status == "executed" && record.executed_at.present? && record.executed_at <= as_of ? record.executed_at : nil,
        }
      end
    end
  end
end
