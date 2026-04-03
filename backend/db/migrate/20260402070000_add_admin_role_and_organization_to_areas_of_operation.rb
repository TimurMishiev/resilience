class AddAdminRoleAndOrganizationToAreasOfOperation < ActiveRecord::Migration[7.1]
  def up
    add_reference :areas_of_operation, :organization, type: :uuid, foreign_key: true
    add_index :areas_of_operation, [:organization_id, :name]

    execute <<~SQL
      UPDATE areas_of_operation AS areas
      SET organization_id = derived.organization_id
      FROM (
        SELECT sites.area_of_operation_id, MIN(sites.organization_id::text)::uuid AS organization_id
        FROM sites
        WHERE sites.area_of_operation_id IS NOT NULL
          AND sites.organization_id IS NOT NULL
        GROUP BY sites.area_of_operation_id
      ) AS derived
      WHERE areas.id = derived.area_of_operation_id
        AND areas.organization_id IS NULL
    SQL

    execute <<~SQL
      UPDATE areas_of_operation AS areas
      SET organization_id = users.organization_id
      FROM users
      WHERE areas.created_by_id = users.id
        AND users.organization_id IS NOT NULL
        AND areas.organization_id IS NULL
    SQL

    execute <<~SQL
      ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_role_check
    SQL

    execute <<~SQL
      ALTER TABLE users
      ADD CONSTRAINT users_role_check
      CHECK (role IN ('viewer', 'operator', 'commander', 'admin'))
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
      CHECK (role IN ('viewer', 'operator', 'commander'))
    SQL

    remove_index :areas_of_operation, column: [:organization_id, :name]
    remove_reference :areas_of_operation, :organization, type: :uuid, foreign_key: true
  end
end
