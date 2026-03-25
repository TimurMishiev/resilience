class AddSignalTypeOccurredAtIndexToExternalSignals < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def change
    add_index :external_signals, [:signal_type, :occurred_at],
              name: "index_external_signals_on_signal_type_and_occurred_at",
              algorithm: :concurrently
  end
end
