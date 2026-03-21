class AddMitreTagsToCorrelationRules < ActiveRecord::Migration[8.0]
  def change
    add_column :correlation_rules, :mitre_tags, :text, array: true, default: []
  end
end
