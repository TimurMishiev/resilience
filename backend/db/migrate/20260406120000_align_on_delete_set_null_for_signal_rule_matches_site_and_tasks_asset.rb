class AlignOnDeleteSetNullForSignalRuleMatchesSiteAndTasksAsset < ActiveRecord::Migration[8.0]
  # Aligns DB-level ON DELETE behavior with Rails model semantics:
  #   - Site has_many :signal_rule_matches, dependent: :nullify
  #   - Asset has_many :tasks, dependent: :nullify
  # Both FK constraints previously defaulted to RESTRICT (no ON DELETE clause).
  def up
    remove_foreign_key :signal_rule_matches, column: :site_id, if_exists: true
    add_foreign_key :signal_rule_matches, :sites, column: :site_id, on_delete: :nullify

    remove_foreign_key :tasks, column: :asset_id, if_exists: true
    add_foreign_key :tasks, :assets, column: :asset_id, on_delete: :nullify
  end

  def down
    remove_foreign_key :signal_rule_matches, column: :site_id, if_exists: true
    add_foreign_key :signal_rule_matches, :sites, column: :site_id

    remove_foreign_key :tasks, column: :asset_id, if_exists: true
    add_foreign_key :tasks, :assets, column: :asset_id
  end
end
