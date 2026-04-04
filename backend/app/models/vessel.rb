class Vessel < ApplicationRecord
  LOITERING_SPEED_MAX_MS = 1.03 # 2 knots in m/s

  # ── Associations ────────────────────────────────────────────────────────────
  belongs_to :last_signal, class_name: "ExternalSignal", optional: true
  has_many   :vessel_tracks, dependent: :destroy

  # ── Validations ─────────────────────────────────────────────────────────────
  validates :mmsi,          presence: true, uniqueness: true
  validates :lat,           presence: true, numericality: { greater_than_or_equal_to: -90,  less_than_or_equal_to: 90  }
  validates :lng,           presence: true, numericality: { greater_than_or_equal_to: -180, less_than_or_equal_to: 180 }
  validates :first_seen_at, presence: true
  validates :last_seen_at,  presence: true

  # ── Scopes ──────────────────────────────────────────────────────────────────

  # Vessels not seen within the given duration — primary input for gap detection.
  # Usage: Vessel.dark_since(20.minutes)
  scope :dark_since, ->(duration) { where("last_seen_at < ?", duration.ago) }

  # Vessels currently flagged as loitering by the detection job.
  scope :loitering, -> { where.not(loitering_since: nil) }

  # ── Class Methods ────────────────────────────────────────────────────────────

  # Upsert a vessel record from an AIS signal payload.
  # Returns [vessel, created_boolean].
  #
  # Design note: we use find_or_initialize_by on mmsi (the real-world identity),
  # then update all fields. This is intentionally NOT Rails upsert_all because
  # we need the returned object and we want callbacks/validations to run.
  #
  # first_seen_at is only set on creation — never overwritten.
  # last_seen_at is always updated to the signal's occurred_at.
  def self.upsert_from_signal!(signal)
    payload = signal.raw_payload || {}
    created = false

    vessel = transaction do
      v = find_or_initialize_by(mmsi: signal.external_id)
      created = v.new_record?

      v.assign_attributes(
        # name: prefer the vessel's registered name, fall back to radio callsign.
        # AIS stores name under "name" key, callsign under "callsign" key.
        name:           payload["name"] || payload["callsign"],
        # vessel_type: AIS TYPE field is a numeric code (e.g. 70=cargo, 80=tanker).
        # Stored as-is; a lookup table can map codes to labels in the UI.
        vessel_type:    payload["vessel_type"]&.to_s,
        flag:           payload["flag"],
        # AIS service stores destination under "dest" (not "destination").
        destination:    payload["dest"] || payload["destination"],
        lat:            signal.lat,
        lng:            signal.lng,
        speed:          signal.speed,
        heading:        signal.heading,
        last_seen_at:   signal.occurred_at,
        last_signal_id: signal.id,
        first_seen_at:  v.first_seen_at || signal.occurred_at
      )

      v.save!
      v
    end

    [ vessel, created ]
  rescue ActiveRecord::RecordNotUnique
    # Concurrent insert for the same MMSI — retry with the now-persisted record.
    retry
  end

  # ── Instance Methods ─────────────────────────────────────────────────────────

  # Has this vessel been unseen for longer than the given duration?
  # Used by gap detection to determine if an alert should be synthesized.
  def dark?(since: 20.minutes)
    last_seen_at < since.ago
  end

  # Is this vessel currently moving at loitering speed (≤ 2 knots)?
  # Speed is stored in m/s after AIS ingestion.
  def loitering_speed?
    speed.present? && speed <= LOITERING_SPEED_MAX_MS
  end
end
