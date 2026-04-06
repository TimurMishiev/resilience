class AddMissingFkIndexes < ActiveRecord::Migration[8.0]
  disable_ddl_transaction!

  def change
    add_index :recommendations, :reviewed_by_id, algorithm: :concurrently
    add_index :incidents, :area_of_operation_id, algorithm: :concurrently
    add_index :incidents, :prosecuted_by_id, algorithm: :concurrently
  end
end
