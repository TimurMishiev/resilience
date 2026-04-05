class AddTimestampsToSignalRuleMatches < ActiveRecord::Migration[8.1]
  def change
    add_timestamps :signal_rule_matches, default: -> { "now()" }, null: false
  end
end
