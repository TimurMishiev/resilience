class CreateTasks < ActiveRecord::Migration[8.1]
  def change
    create_table :tasks, id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
      t.references :site, type: :uuid, null: false, foreign_key: true
      t.references :asset, type: :uuid, null: true, foreign_key: true
      t.text :title, null: false
      t.text :description
      t.text :priority, null: false, default: "normal"
      t.text :workflow_status, null: false, default: "new"
      t.text :blocked_reason
      t.datetime :resolved_at, precision: 6
      t.timestamps null: false
    end

    add_index :tasks, :workflow_status

    # DB-enforced consistency: blocked_reason must be present iff workflow_status is 'blocked'
    execute <<~SQL
      ALTER TABLE tasks ADD CONSTRAINT blocked_reason_consistency CHECK (
        (workflow_status = 'blocked' AND blocked_reason IS NOT NULL)
        OR (workflow_status != 'blocked' AND blocked_reason IS NULL)
      )
    SQL
  end
end
