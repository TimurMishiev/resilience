class RenameAssetStatuses < ActiveRecord::Migration[8.1]
  def up
    execute "UPDATE assets SET status = 'assigned' WHERE status = 'in_use'"
    execute "UPDATE assets SET status = 'degraded'  WHERE status = 'maintenance'"
  end

  def down
    execute "UPDATE assets SET status = 'in_use'      WHERE status = 'assigned'"
    execute "UPDATE assets SET status = 'maintenance' WHERE status = 'degraded'"
  end
end
