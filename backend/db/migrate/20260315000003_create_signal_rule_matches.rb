class CreateSignalRuleMatches < ActiveRecord::Migration[8.1]
  def change
    create_table :signal_rule_matches, id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
      t.references :signal,           type: :uuid, null: false, foreign_key: true
      t.references :correlation_rule, type: :uuid, null: false, foreign_key: true
      t.references :site,             type: :uuid, null: true,  foreign_key: true
      t.references :task,             type: :uuid, null: true,  foreign_key: true
      t.datetime   :fired_at, precision: 6, null: false, default: -> { "now()" }
      t.jsonb      :metadata, null: false, default: {}
    end

    add_index :signal_rule_matches, :fired_at
  end
end
