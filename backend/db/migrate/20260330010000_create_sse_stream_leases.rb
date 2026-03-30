class CreateSseStreamLeases < ActiveRecord::Migration[8.0]
  def change
    create_table :sse_stream_leases, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.references :user, null: false, type: :uuid, foreign_key: true

      t.string :stream_name, null: false
      t.string :remote_ip, null: false
      t.string :lease_key, null: false
      t.datetime :expires_at, null: false

      t.timestamps
    end

    add_index :sse_stream_leases, :lease_key,
              unique: true,
              name: "idx_sse_stream_leases_lease_key"

    add_index :sse_stream_leases, %i[user_id expires_at],
              name: "idx_sse_stream_leases_user_expiry"

    add_index :sse_stream_leases, %i[remote_ip expires_at],
              name: "idx_sse_stream_leases_ip_expiry"

    add_index :sse_stream_leases, %i[stream_name expires_at],
              name: "idx_sse_stream_leases_stream_expiry"
  end
end
