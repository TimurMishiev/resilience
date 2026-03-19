class CreateVessels < ActiveRecord::Migration[8.1]
  def change
    create_table :vessels, id: :uuid do |t|
      # ── Identity ────────────────────────────────────────────────────────────
      # MMSI (Maritime Mobile Service Identity) is the vessel's real-world
      # unique identifier — a 9-digit number assigned by the ITU. It is the
      # authoritative key we use to de-duplicate across AIS pings.
      t.string :mmsi, null: false

      # Human-readable fields from AIS transponder broadcasts.
      # All nullable — not every vessel broadcasts complete information.
      t.string :name
      t.string :vessel_type   # cargo, tanker, military, fishing, etc.
      t.string :flag          # ISO 3166-1 alpha-2 country code (e.g. "IR", "CN")
      t.string :destination   # reported destination from AIS (unreliable, but useful)

      # ── Current Position ────────────────────────────────────────────────────
      # Latest known position. Updated in-place on every AIS ping.
      # Not null — a vessel without a position is not a vessel we can reason about.
      t.float :lat,     null: false
      t.float :lng,     null: false
      t.float :speed    # knots
      t.float :heading  # degrees 0–359

      # ── Temporal Anchors ────────────────────────────────────────────────────
      # first_seen_at: when we first observed this vessel — never updated.
      # last_seen_at:  when the most recent AIS ping arrived — updated on every upsert.
      # These two fields together define the vessel's observation window.
      # last_seen_at is what the gap detection job queries.
      t.datetime :first_seen_at, null: false
      t.datetime :last_seen_at,  null: false

      # ── Provenance ──────────────────────────────────────────────────────────
      # FK to the exact ExternalSignal row that produced the current state.
      # This is the traceability link: entity state → source observation.
      # Nullable because on first upsert, the signal is created in the same
      # transaction and we set this immediately after.
      t.references :last_signal, type: :uuid, foreign_key: { to_table: :external_signals }, null: true

      # ── Derived Behavioral State ─────────────────────────────────────────────
      # loitering_since: set by the loitering detection job when a vessel has
      # been moving < 2 knots in a monitored zone for > 15 minutes.
      # Cleared when the vessel resumes normal speed.
      # This is a derived property — no sensor reports it directly.
      # Its presence on the entity (not just as a query result) is the
      # ontological choice: loitering is a property of the vessel, not a signal.
      t.datetime :loitering_since

      t.timestamps
    end

    # ── Indexes ────────────────────────────────────────────────────────────────

    # Unique constraint on mmsi — enforced at both DB and model level.
    # This is the entity identity constraint. Two rows with the same MMSI
    # would mean two conflicting truths about the same vessel.
    add_index :vessels, :mmsi, unique: true

    # Index on last_seen_at — the gap detection job's primary query:
    #   WHERE last_seen_at < 20.minutes.ago
    # Without this index, that query is a full table scan.
    add_index :vessels, :last_seen_at

    # Partial index on loitering_since for non-null rows only.
    # The loitering alert dashboard only cares about vessels currently loitering.
    # A partial index keeps this small and fast.
    add_index :vessels, :loitering_since, where: "loitering_since IS NOT NULL"
  end
end
