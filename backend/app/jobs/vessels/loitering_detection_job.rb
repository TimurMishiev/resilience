module Vessels
  # Flags vessels as loitering when they remain slow and geographically confined
  # for a sustained dwell window. Unlike AIS gap detection, loitering is stored
  # as vessel state rather than a derived signal so it can enrich any vessel
  # inspection surface directly.
  class LoiteringDetectionJob < ApplicationJob
    queue_as :background

    LOOKBACK_WINDOW = 2.hours
    MIN_DWELL       = 30.minutes
    MIN_TRACK_POINTS = 3
    MAX_RADIUS_KM   = 3.0

    def perform
      @job_now = Time.current
      @window_start = @job_now - LOOKBACK_WINDOW
      changed = 0

      Vessel
        .where("last_seen_at >= ? OR loitering_since IS NOT NULL", @window_start)
        .find_each do |vessel|
          next_loitering_since = detect_loitering_since(vessel)
          next if vessel.loitering_since == next_loitering_since

          vessel.update!(loitering_since: next_loitering_since)
          changed += 1
        end

      Rails.logger.info "[LoiteringDetection] evaluated vessel state, updated #{changed} records"
    end

    private

    Point = Struct.new(:lat, :lng, :speed, :occurred_at, keyword_init: true)

    def detect_loitering_since(vessel)
      points = recent_points_for(vessel)
      return nil if points.size < MIN_TRACK_POINTS

      if vessel.loitering_since.present?
        persisted_subset = points.select { |point| point.occurred_at >= vessel.loitering_since }
        return vessel.loitering_since if loitering_subset?(persisted_subset)
      end

      latest_time = points.last.occurred_at

      points.each_index do |start_index|
        subset = points[start_index..]
        next if subset.size < MIN_TRACK_POINTS
        next if latest_time - subset.first.occurred_at < MIN_DWELL

        return subset.first.occurred_at if loitering_subset?(subset)
      end

      nil
    end

    def recent_points_for(vessel)
      points = vessel
        .vessel_tracks
        .where("occurred_at >= ?", @window_start)
        .order(:occurred_at)
        .map do |track|
          Point.new(
            lat: track.lat,
            lng: track.lng,
            speed: track.speed,
            occurred_at: track.occurred_at,
          )
        end

      if points.empty? || points.last.occurred_at != vessel.last_seen_at
        points << Point.new(
          lat: vessel.lat,
          lng: vessel.lng,
          speed: vessel.speed,
          occurred_at: vessel.last_seen_at,
        )
      end

      points
    end

    def loitering_subset?(points)
      return false if points.size < MIN_TRACK_POINTS
      return false if points.last.occurred_at - points.first.occurred_at < MIN_DWELL
      return false unless points.all? { |point| point.speed.present? && point.speed <= Vessel::LOITERING_SPEED_MAX_MS }

      anchor = points.first
      points.all? do |point|
        Correlations::EvaluatorService.haversine_km(
          anchor.lat,
          anchor.lng,
          point.lat,
          point.lng,
        ) <= MAX_RADIUS_KM
      end
    end
  end
end
