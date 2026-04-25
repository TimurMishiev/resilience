class CreateIngestionCursors < ActiveRecord::Migration[8.1]
  # High-water-mark cursor for signal-consumer jobs so a queue-latency
  # spike cannot silently drop signals between job ticks.
  #
  # Replaces the old wall-clock WINDOW_SECONDS.ago pattern in
  # Correlations::EvaluateRecentJob. The previous job selected signals
  # with ingested_at within a 32-second window of Time.current; if the
  # SolidQueue worker was even 3 seconds behind, signals in the
  # latency gap were permanently skipped because the next tick's
  # window had already moved past them.
  #
  # The cursor is (ingested_at, signal_id) to break ties deterministically
  # when multiple signals share the same ingested_at microsecond — the
  # same discipline used for audit_events.sequence.
  def change
    create_table :ingestion_cursors, id: :uuid do |t|
      # Logical name of the consumer (e.g. "correlations.evaluate_recent").
      # Each consumer owns one row; the job looks up its cursor by name.
      t.string :name, null: false

      # High-water ingested_at + the id of the signal at that timestamp.
      # A tick reads signals strictly greater than (last_ingested_at,
      # last_signal_id) lexicographically — so ties resolve by id and
      # no signal is ever processed twice or skipped.
      t.datetime :last_ingested_at, precision: 6, null: false
      t.uuid :last_signal_id

      t.timestamps

      t.index :name, unique: true, name: "index_ingestion_cursors_on_name_unique"
    end
  end
end
