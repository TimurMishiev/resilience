class CreateUsers < ActiveRecord::Migration[8.1]
  def change
    create_table :users, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.string :email,           null: false
      t.string :password_digest, null: false
      t.string :role,            null: false, default: "operator"

      t.timestamps
    end

    add_index :users, :email, unique: true
    add_check_constraint :users, "role IN ('operator', 'commander')", name: "users_role_check"
  end
end
