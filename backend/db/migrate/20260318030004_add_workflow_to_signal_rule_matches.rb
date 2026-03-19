class AddWorkflowToSignalRuleMatches < ActiveRecord::Migration[8.1]
  def change
    add_column :signal_rule_matches, :workflow_status, :string,   null: false, default: "unacknowledged"
    add_column :signal_rule_matches, :acknowledged_at, :datetime
    add_column :signal_rule_matches, :notes,           :text

    # acknowledged_by tracks who performed the last status transition.
    # Nullable — the firing actor is the system, not a human.
    add_reference :signal_rule_matches, :acknowledged_by,
                  type:        :uuid,
                  foreign_key: { to_table: :users },
                  null:        true

    # Filtered by status on the alert feed (e.g. WHERE workflow_status = 'unacknowledged').
    add_index :signal_rule_matches, :workflow_status
  end
end
