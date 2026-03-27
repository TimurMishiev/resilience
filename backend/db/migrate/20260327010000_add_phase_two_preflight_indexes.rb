class AddPhaseTwoPreflightIndexes < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def change
    add_index :sites, :status, algorithm: :concurrently
    add_index :signal_rule_matches, [:correlation_rule_id, :fired_at], algorithm: :concurrently
  end
end
