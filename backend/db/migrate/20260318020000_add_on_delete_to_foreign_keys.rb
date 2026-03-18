class AddOnDeleteToForeignKeys < ActiveRecord::Migration[8.0]
  def up
    # areas_of_operation.created_by_id — user deletion should not destroy AOs,
    # just clear the audit field.
    remove_foreign_key :areas_of_operation, column: :created_by_id
    add_foreign_key :areas_of_operation, :users, column: :created_by_id, on_delete: :nullify

    # correlation_rules.created_by_id — same rationale: deleting a user should
    # not cascade to their rules.
    remove_foreign_key :correlation_rules, column: :created_by_id
    add_foreign_key :correlation_rules, :users, column: :created_by_id, on_delete: :nullify

    # signal_rule_matches.correlation_rule_id — the Rails model already has
    # dependent: :destroy, so the DB constraint should mirror that behaviour
    # and cascade the delete at the database layer as a safety net.
    remove_foreign_key :signal_rule_matches, column: :correlation_rule_id
    add_foreign_key :signal_rule_matches, :correlation_rules, column: :correlation_rule_id, on_delete: :cascade

    # tasks.site_id — a site cannot be deleted while it still has tasks; this
    # matches the application-level restrict_with_error intent and makes the
    # constraint explicit at the DB layer.
    remove_foreign_key :tasks, column: :site_id
    add_foreign_key :tasks, :sites, column: :site_id, on_delete: :restrict
  end

  def down
    remove_foreign_key :areas_of_operation, column: :created_by_id
    add_foreign_key :areas_of_operation, :users, column: :created_by_id

    remove_foreign_key :correlation_rules, column: :created_by_id
    add_foreign_key :correlation_rules, :users, column: :created_by_id

    remove_foreign_key :signal_rule_matches, column: :correlation_rule_id
    add_foreign_key :signal_rule_matches, :correlation_rules, column: :correlation_rule_id

    remove_foreign_key :tasks, column: :site_id
    add_foreign_key :tasks, :sites, column: :site_id
  end
end
