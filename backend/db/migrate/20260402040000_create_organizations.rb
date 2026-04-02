class CreateOrganizations < ActiveRecord::Migration[8.0]
  def change
    create_table :organizations, id: :uuid, default: "gen_random_uuid()" do |t|
      t.string :name, null: false
      t.string :slug, null: false

      t.timestamps
    end

    add_index :organizations, :slug, unique: true

    # Add organization_id to users. NULL during migration = legacy / single-tenant.
    # Enforce NOT NULL once all rows are back-filled in a follow-up deployment.
    add_reference :users, :organization, type: :uuid, foreign_key: true, null: true

    # Sites are the root anchor for most operational data. Org-scoping sites
    # transitively scopes assets, tasks, incidents, and rule matches.
    add_reference :sites, :organization, type: :uuid, foreign_key: true, null: true
  end
end
