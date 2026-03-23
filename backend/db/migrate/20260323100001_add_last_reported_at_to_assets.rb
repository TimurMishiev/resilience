class AddLastReportedAtToAssets < ActiveRecord::Migration[8.1]
  def change
    add_column :assets, :last_reported_at, :datetime
  end
end
