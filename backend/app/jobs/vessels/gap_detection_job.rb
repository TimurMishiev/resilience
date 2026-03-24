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

    # Rough bounding-box check against AO geometries.
    # AO geometry is GeoJSON — we check the vessel's last position against
    # the bounding box of each AO polygon as a fast pre-filter.
    # Full polygon containment (ray casting) is a Phase 2 enhancement.
    def inside_high_threat_ao?(vessel, areas)
      areas.any? do |ao|
        next false unless ao.geometry.is_a?(Hash)

        coords = extract_bbox_coords(ao.geometry)
        next false unless coords

        min_lat, max_lat, min_lng, max_lng = coords
        vessel.lat.between?(min_lat, max_lat) && vessel.lng.between?(min_lng, max_lng)
      end
    end

    def extract_bbox_coords(geojson)
      # Support GeoJSON Polygon and MultiPolygon
      all_coords = case geojson["type"]
                   when "Polygon"
                     geojson.dig("coordinates", 0) || []
                   when "MultiPolygon"
                     (geojson["coordinates"] || []).flat_map { |poly| poly[0] || [] }
                   when "Feature"
                     return extract_bbox_coords(geojson["geometry"] || {})
                   else
                     []
                   end

      return nil if all_coords.empty?

      lngs = all_coords.map { |c| c[0].to_f }
      lats = all_coords.map { |c| c[1].to_f }
      [ lats.min, lats.max, lngs.min, lngs.max ]
    end
  end
end
