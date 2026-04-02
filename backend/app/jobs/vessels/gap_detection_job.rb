module Vessels
  # Scans the vessels table for AIS transponders that have gone dark and
  # synthesizes an ExternalSignal of type "ais_gap" for each detected gap.
  #
  # A synthesized signal flows through the existing correlation engine unchanged —
  # operators can write rules that fire on signal_type: "ais_gap" exactly as
  # they would for any live feed signal.
  #
  # Confidence scoring
  # ------------------
  # "Dark" is not binary. We score each gap based on last known motion and
  # location context, producing a 0.0–1.0 confidence value stored as magnitude:
  #
  #   Base score         0.50  — vessel dark, cause unknown
  #   Last speed > 5kn  +0.25  — was clearly underway, unexpected stop
  #   Last speed < 1kn  -0.20  — was likely stationary (docked/anchored)
  #   Inside high AO    +0.20  — threat context amplifies concern
  #
  # Speed stored on external_signals is in m/s (AIS SOG converted at ingestion).
  # 5 knots = 2.57 m/s   |   1 knot = 0.51 m/s
  #
  # Idempotency
  # -----------
  # External ID = "gap_#{mmsi}_#{last_seen_at.to_i}"
  # Ties the gap event to when the vessel went dark, not when the job ran.
  # Re-running the job on a still-dark vessel produces the same external_id →
  # IngestService returns created: false. No duplicate signals.
  class GapDetectionJob < ApplicationJob
    queue_as :background

    GAP_THRESHOLD  = 20.minutes
    SPEED_HIGH_MS  = 2.57  # 5 knots in m/s — clearly underway
    SPEED_LOW_MS   = 0.51  # 1 knot  in m/s — likely stationary
    HIGH_THREAT_AO = %w[red black].freeze

    def perform
      # Load to array once — avoids three separate DB round-trips (.none?, .each, .count).
      # Speed, lat, and lng are denormalized onto vessels by upsert_from_signal!, so no
      # association eager-loading is needed here.
      dark_vessels = Vessel.dark_since(GAP_THRESHOLD).to_a

      return if dark_vessels.empty?

      # Load high-threat AO geometries once — used for location context scoring
      high_threat_aos = AreaOfOperation.where(threat_level: HIGH_THREAT_AO)

      synthesized = 0

      dark_vessels.each do |vessel|
        confidence = compute_confidence(vessel, high_threat_aos)

        result = Signals::IngestService.call(
          source:      "derived",
          signal_type: "ais_gap",
          external_id: "gap_#{vessel.mmsi}_#{vessel.last_seen_at.to_i}",
          lat:         vessel.lat,
          lng:         vessel.lng,
          # occurred_at is anchored to last_seen_at — when the vessel went dark,
          # not when this job ran. Combined with external_id, this makes the
          # gap signal fully idempotent across job runs.
          occurred_at: vessel.last_seen_at,
          magnitude:   confidence.round(2),
          raw_payload: {
            mmsi:            vessel.mmsi,
            vessel_name:     vessel.name,
            vessel_type:     vessel.vessel_type,
            flag:            vessel.flag,
            last_seen_at:    vessel.last_seen_at.iso8601,
            gap_minutes:     ((Time.current - vessel.last_seen_at) / 60).round,
            last_speed_ms:   vessel.speed,
            confidence:      confidence.round(2)
          }
        )

        synthesized += 1 if result.success && result.payload[:created]
      end

      Rails.logger.info "[GapDetection] scanned #{dark_vessels.size} dark vessels, synthesized #{synthesized} new gap signals"
    end

    private

    def compute_confidence(vessel, high_threat_aos)
      score = 0.50

      # Motion modifier — was the vessel underway before going dark?
      if vessel.speed.present?
        if vessel.speed >= SPEED_HIGH_MS
          score += 0.25   # clearly underway — unexpected stop is suspicious
        elsif vessel.speed < SPEED_LOW_MS
          score -= 0.20   # was nearly stationary — probable docking/anchoring
        end
      end

      # Location context — is this vessel near a high-threat area?
      if inside_high_threat_ao?(vessel, high_threat_aos)
        score += 0.20
      end

      # Clamp to valid range
      score.clamp(0.0, 1.0)
    end

    # Exact point-in-polygon check against GeoJSON AO geometry.
    # Supports Polygon, MultiPolygon, and Feature-wrapped geometry.
    # Coordinates are GeoJSON [lng, lat].
    def inside_high_threat_ao?(vessel, areas)
      point = [ vessel.lng.to_f, vessel.lat.to_f ]

      areas.any? do |ao|
        next false unless ao.geometry.is_a?(Hash)

        geometry_contains_point?(ao.geometry, point)
      end
    end

    def geometry_contains_point?(geojson, point)
      case geojson["type"]
      when "Polygon"
        polygon_contains_point?(geojson["coordinates"] || [], point)
      when "MultiPolygon"
        Array(geojson["coordinates"]).any? { |polygon| polygon_contains_point?(polygon, point) }
      when "Feature"
        geometry_contains_point?(geojson["geometry"] || {}, point)
      else
        false
      end
    end

    def polygon_contains_point?(polygon_coords, point)
      outer_ring = Array(polygon_coords).first || []
      holes = Array(polygon_coords).drop(1)
      return false unless ring_contains_point?(outer_ring, point)

      holes.none? { |hole| ring_contains_point?(hole, point) }
    end

    def ring_contains_point?(ring, point)
      normalized_ring = normalize_ring(ring)
      return false if normalized_ring.size < 4

      x = point[0].to_f
      y = point[1].to_f
      inside = false

      normalized_ring.each_cons(2) do |(x1, y1), (x2, y2)|
        x1 = x1.to_f
        y1 = y1.to_f
        x2 = x2.to_f
        y2 = y2.to_f

        return true if point_on_segment?(x, y, x1, y1, x2, y2)

        crosses_latitude = (y1 > y) != (y2 > y)
        next unless crosses_latitude

        intersection_x = ((x2 - x1) * (y - y1) / (y2 - y1)) + x1
        inside = !inside if x < intersection_x
      end

      inside
    end

    def normalize_ring(ring)
      points = Array(ring).map { |coord| [ coord[0], coord[1] ] }
      return points if points.empty? || points.first == points.last

      points + [ points.first ]
    end

    def point_on_segment?(x, y, x1, y1, x2, y2)
      cross_product = (y - y1) * (x2 - x1) - (x - x1) * (y2 - y1)
      return false unless cross_product.abs < 1e-9

      dot_product = (x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)
      return false if dot_product.negative?

      squared_length = (x2 - x1)**2 + (y2 - y1)**2
      dot_product <= squared_length
    end
  end
end
