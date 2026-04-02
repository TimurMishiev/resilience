class AllowViewerRoleInUsers < ActiveRecord::Migration[8.0]
  def up
    execute <<~SQL
      ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_role_check
    SQL

    execute <<~SQL
      ALTER TABLE users
      ADD CONSTRAINT users_role_check
      CHECK (role IN ('viewer', 'operator', 'commander'))
    SQL
  end

  def down
    execute <<~SQL
      ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_role_check
    SQL

    execute <<~SQL
      ALTER TABLE users
      ADD CONSTRAINT users_role_check
      CHECK (role IN ('operator', 'commander'))
    SQL
  end
end
