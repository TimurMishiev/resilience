class AllowNullCorrelationRuleInMatches < ActiveRecord::Migration[8.0]
  def change
    change_column_null :signal_rule_matches, :correlation_rule_id, true
  end
end
