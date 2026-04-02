class CreateRevokedJwts < ActiveRecord::Migration[8.0]
  def change
    create_table :revoked_jwts, id: :uuid do |t|
      t.string :jti, null: false
      t.datetime :expires_at, null: false
      t.timestamps
    end

    add_index :revoked_jwts, :jti, unique: true
    add_index :revoked_jwts, :expires_at
  end
end
