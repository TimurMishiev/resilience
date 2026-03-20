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
    # Rough bounding-box pre-filter (exact Haversine done in Ruby)
    deg = km / 111.0
    where(lat: (lat.to_f - deg)..(lat.to_f + deg), lng: (lng.to_f - deg)..(lng.to_f + deg))
  }
end
