class RenameSignalsToExternalSignals < ActiveRecord::Migration[8.1]
  def change
    rename_table :signals, :external_signals
  end
end
