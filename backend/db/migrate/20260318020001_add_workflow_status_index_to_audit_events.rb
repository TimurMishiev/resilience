class AddWorkflowStatusIndexToAuditEvents < ActiveRecord::Migration[8.0]
  def up
    # Add a generated column that extracts workflow_status from the after_snapshot
    # JSONB field so it can be indexed efficiently for analytics queries that group
    # or filter on post-transition workflow status.
    execute <<~SQL
      ALTER TABLE audit_events
        ADD COLUMN after_workflow_status text
          GENERATED ALWAYS AS (after_snapshot->>'workflow_status') STORED;
    SQL

    add_index :audit_events, :after_workflow_status,
              name: "index_audit_events_on_after_workflow_status",
              where: "after_workflow_status IS NOT NULL"

    # Compound index for the most common analytics query: status transitions per
    # entity over time.
    add_index :audit_events, %i[entity_type after_workflow_status occurred_at],
              name: "index_audit_events_analytics"
  end

  def down
    remove_index :audit_events, name: "index_audit_events_analytics"
    remove_index :audit_events, name: "index_audit_events_on_after_workflow_status"

    execute "ALTER TABLE audit_events DROP COLUMN after_workflow_status;"
  end
end
