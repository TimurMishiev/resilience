class AddViewerRoleAndAoScopeToUsers < ActiveRecord::Migration[8.0]
  def change
    # area_of_operation_id limits a viewer (or any user) to a specific AO's
    # sites, assets, and tasks. NULL means unrestricted (full access per role).
    add_column :users, :area_of_operation_id, :uuid, null: true
    add_index  :users, :area_of_operation_id
    add_foreign_key :users, :areas_of_operation, column: :area_of_operation_id
  end
end
