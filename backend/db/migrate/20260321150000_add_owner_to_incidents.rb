class AddOwnerToIncidents < ActiveRecord::Migration[8.0]
  def change
    add_reference :incidents, :assigned_to, type: :uuid, null: true,
                  foreign_key: { to_table: :users }
    add_column    :incidents, :assigned_at, :datetime, null: true
  end
end
