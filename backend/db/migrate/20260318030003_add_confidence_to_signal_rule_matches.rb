class AddConfidenceToSignalRuleMatches < ActiveRecord::Migration[8.1]
  def change
    add_column :signal_rule_matches, :confidence, :float, null: false, default: 0.0

    # Index supports alert-feed queries ordered by confidence (high-to-low)
    # and filtered by threshold (e.g. WHERE confidence >= 0.7).
    add_index :signal_rule_matches, :confidence
  end
end
