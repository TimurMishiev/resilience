class AddIngestedAtIdIndexToExternalSignals < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def change
    add_index :external_signals, [:ingested_at, :id],
              name: "index_external_signals_on_ingested_at_and_id",
              algorithm: :concurrently
  end
end
