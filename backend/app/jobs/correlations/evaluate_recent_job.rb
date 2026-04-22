module Correlations
  # Evaluates recently ingested signals against all active correlation rules
  # and checks for geofence breaches.
  #
  # Scheduling: configured as a Solid Queue recurring task in
  # config/recurring.yml (every 30 seconds).
  class EvaluateRecentJob < ApplicationJob
    queue_as :background

    # The evaluation window overlaps the 30-second recurring cadence by 2 seconds
    # so recently ingested signals are not missed between ticks.
    WINDOW_SECONDS = 32

    retry_on StandardError, wait: :polynomially_longer, attempts: 3

    def perform
      window_start = WINDOW_SECONDS.seconds.ago

      recent = ExternalSignal
        .select(:id, :source, :signal_type, :external_id,
                :lat, :lng, :occurred_at, :ingested_at)
        .where(ingested_at: window_start..Time.current)

      active_sites = Site.active
        .where("geofence_radius_km > 0")
        .select(:id, :name, :latitude, :longitude, :geofence_radius_km)
        .to_a

      count = 0
      recent.find_each do |signal|
        Correlations::EvaluatorService.call(signal: signal)
        Sites::GeofenceBreachService.call(signal: signal, sites: active_sites)
        count += 1
      end

      Rails.logger.info "[Correlations::EvaluateRecentJob] evaluated=#{count}" if count > 0
    end
  end
end
