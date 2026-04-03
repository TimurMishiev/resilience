class CreateUserSessions < ActiveRecord::Migration[7.1]
  def change
    create_table :user_sessions, id: :uuid do |t|
      t.references :user, null: false, type: :uuid, foreign_key: true
      t.string :jti, null: false
      t.string :user_agent
      t.string :ip_address
      t.datetime :last_seen_at, null: false
      t.datetime :expires_at, null: false
      t.datetime :revoked_at
      t.references :revoked_by, type: :uuid, foreign_key: { to_table: :users }
      t.string :revoke_reason
      t.timestamps
    end

    add_index :user_sessions, :jti, unique: true
    add_index :user_sessions, [:user_id, :last_seen_at]
    add_index :user_sessions, :expires_at
    add_index :user_sessions, :revoked_at
  end
end
