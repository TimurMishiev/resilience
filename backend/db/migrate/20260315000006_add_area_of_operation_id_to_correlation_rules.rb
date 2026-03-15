class AddAreaOfOperationIdToCorrelationRules < ActiveRecord::Migration[8.1]
  def change
    add_column :correlation_rules, :area_of_operation_id, :uuid, null: true
    add_index  :correlation_rules, :area_of_operation_id,
      name: "index_correlation_rules_on_area_of_operation_id"
    add_foreign_key :correlation_rules, :areas_of_operation,
      column: :area_of_operation_id, on_delete: :nullify
  end
end
