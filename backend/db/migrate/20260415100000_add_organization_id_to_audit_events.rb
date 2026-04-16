class AddOrganizationIdToAuditEvents < ActiveRecord::Migration[8.0]
  def change
    add_column :audit_events, :organization_id, :uuid, null: true
    add_index :audit_events, :organization_id, where: "organization_id IS NOT NULL"
  end
end
