class CreateVesselTracks < ActiveRecord::Migration[8.1]
  def change
    create_table :vessel_tracks, id: :uuid do |t|
      # ── Entity link ─────────────────────────────────────────────────────────
      # Every track point belongs to a vessel. CASCADE means when a vessel row
      # is deleted, all its track history is also deleted automatically.
      # This is the correct FK strategy for owned time-series data.
      t.references :vessel, type: :uuid, null: false,
                             foreign_key: { on_delete: :cascade }

      # ── Position snapshot ───────────────────────────────────────────────────
      t.float    :lat,     null: false
      t.float    :lng,     null: false
      t.float    :speed
      t.float    :heading

      # ── Temporal anchor ─────────────────────────────────────────────────────
      # occurred_at is the AIS timestamp — when the vessel was at this position.
      # This is the primary axis for all track queries and retention deletes.
      t.datetime :occurred_at, null: false

      # Intentionally no updated_at — this table is append-only.
      # The absence of updated_at signals that intent to every reader.
      t.datetime :created_at, null: false
    end

    # ── Indexes ────────────────────────────────────────────────────────────────

    # Primary read index: "all positions for vessel X between time A and B"
    # vessel_id leads — narrows to one vessel first, then occurred_at is a
    # btree range seek. Reversed order (occurred_at, vessel_id) would be wrong.
    add_index :vessel_tracks, [ :vessel_id, :occurred_at ]

    # Retention index: "delete all rows older than 7 days"
    # The retention job queries WHERE occurred_at < N.days.ago across ALL vessels.
    # Without this index that query scans the entire table.
    # This is the second index you identified — justified by the write pattern.
    add_index :vessel_tracks, :occurred_at
  end
end
