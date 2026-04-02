class ExternalSignal < ApplicationRecord
  SOURCES = %w[opensky ais usgs_seismic gpsjam firms_wildfire manual derived acled gdacs].freeze
  SIGNAL_TYPES = %w[aircraft_position vessel_position seismic_event gps_jamming wildfire manual ais_gap conflict_event disaster_alert].freeze

  has_many :signal_rule_matches, foreign_key: :signal_id, dependent: :destroy

  validates :source,      presence: true, inclusion: { in: SOURCES }
  validates :signal_type, presence: true, inclusion: { in: SIGNAL_TYPES }
  validates :external_id, presence: true
  validates :lat,         presence: true, numericality: { greater_than_or_equal_to: -90,  less_than_or_equal_to: 90 }
  validates :lng,         presence: true, numericality: { greater_than_or_equal_to: -180, less_than_or_equal_to: 180 }
  validates :occurred_at, presence: true

  scope :recent,      ->(minutes = 60) { where(occurred_at: minutes.minutes.ago..Time.current) }
  scope :by_source,   ->(src)          { where(source: src) }
  scope :by_type,     ->(type)         { where(signal_type: type) }
  # near_point: finds signals within km of (lat, lng).
  #
  # When the PostGIS geography column `location` is present, uses ST_DWithin
  # for an exact, index-backed query. Falls back to a bounding-box approximation
  # (Haversine applied in Ruby callers) when PostGIS is not available — e.g.
  # during tests on a plain PostgreSQL instance or before migration runs.
  scope :near_point, ->(lat, lng, km) {
    if column_names.include?("location")
      # ST_DWithin(geography, geography, meters) — exact great-circle distance,
      # uses the GIST spatial index for O(log n) performance.
      point = "ST_SetSRID(ST_MakePoint(#{lng.to_f}, #{lat.to_f}), 4326)::geography"
      where("ST_DWithin(location, #{point}, ?)", km.to_f * 1000)
    else
      # Bounding-box pre-filter — kept as a fallback so all callers continue to
      # work on Postgres instances without PostGIS. Exact Haversine is still
      # applied in Ruby callers for correctness.
      deg_lat = km / 111.0
      deg_lng = km / (111.0 * [Math.cos(lat.to_f * Math::PI / 180.0).abs, 0.01].max)
      where(lat: (lat.to_f - deg_lat)..(lat.to_f + deg_lat), lng: (lng.to_f - deg_lng)..(lng.to_f + deg_lng))
    end
  }
end
