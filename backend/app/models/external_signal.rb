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
  scope :near_point,  ->(lat, lng, km) {
    # Rough bounding-box pre-filter (exact Haversine applied in Ruby callers).
    # Latitude degrees are uniform (~111 km/deg). Longitude degrees narrow toward
    # the poles, so we divide by cos(lat) to avoid an over-wide box at high latitudes.
    deg_lat = km / 111.0
    deg_lng = km / (111.0 * [Math.cos(lat.to_f * Math::PI / 180.0).abs, 0.01].max)
    where(lat: (lat.to_f - deg_lat)..(lat.to_f + deg_lat), lng: (lng.to_f - deg_lng)..(lng.to_f + deg_lng))
  }
end
