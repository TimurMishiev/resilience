class AddFlagFieldsToSites < ActiveRecord::Migration[8.1]
  def change
    add_column :sites, :flagged_at, :datetime
    add_column :sites, :flag_reason, :text
  end
end
