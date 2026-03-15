class AddAreaOfOperationIdToSites < ActiveRecord::Migration[8.1]
  def change
    add_column :sites, :area_of_operation_id, :uuid, null: true
    add_index  :sites, :area_of_operation_id, name: "index_sites_on_area_of_operation_id"
    add_foreign_key :sites, :areas_of_operation,
      column: :area_of_operation_id, on_delete: :nullify
  end
end
