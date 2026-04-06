module Sites
  # Checks whether a newly ingested signal breaches the geofence radius of any
  # active monitored site and creates a SignalRuleMatch record for each breach.
  #
  # Called alongside the correlation engine after each signal is ingested, so
  # geofence alerts are raised even when no explicit correlation rule matches.
  #
  # Idempotent: a second call for the same (signal, site) pair is a no-op.
  # Guaranteed at two layers:
  #   1. Application-level: exists? fast-path skips the INSERT for the common case.
  #   2. DB-level: a partial unique index on (signal_id, site_id) WHERE
  #      correlation_rule_id IS NULL absorbs any concurrent duplicate INSERT via
  #      RecordNotUnique rescue, so back-to-back evaluator runs can never create
  #      duplicate geofence alerts for the same signal/site.
  class GeofenceBreachService < ApplicationService
    def initialize(signal:, sites: nil)
      @signal = signal
      @sites  = sites
    end

    def call
      breached = []

      site_scope = @sites || Site.active.to_a
      site_scope.each do |site|
        next unless site.geofence_radius_km&.positive?

        distance_km = Correlations::EvaluatorService.haversine_km(
          site.latitude.to_f,  site.longitude.to_f,
          @signal.lat.to_f,    @signal.lng.to_f
        )

        next if distance_km > site.geofence_radius_km

        # Fast-path: skip the INSERT if the record already exists.  The DB
        # unique index (idx_geofence_breach_signal_site_unique) is the hard
        # backstop — a concurrent race is absorbed below by RecordNotUnique.
        next if SignalRuleMatch.exists?(
          signal_id:           @signal.id,
          site_id:             site.id,
          correlation_rule_id: nil
        )

        match = SignalRuleMatch.create!(
          signal:              @signal,
          correlation_rule_id: nil,
          site:                site,
          fired_at:            Time.current,
          confidence:          breach_confidence(distance_km, site.geofence_radius_km),
          metadata: {
            distance_km:         distance_km.round(2),
            geofence_radius_km:  site.geofence_radius_km,
            signal_type:         @signal.signal_type,
            signal_source:       @signal.source,
            geofence_breach:     true
          }
        )

        # Preserve the breach notification even if incident fusion fails.
        # Fusion enriches downstream incident state, but operators should still
        # see the geofence alert as soon as the match is committed.
        fuse_incident(match)
        publish_breach(site:, match:, distance_km:)

        breached << { site_id: site.id, match_id: match.id, distance_km: distance_km.round(1) }
      rescue ActiveRecord::RecordNotUnique
        # Concurrent evaluator run beat us to the insert — this is a no-op.
        Rails.logger.debug "[GeofenceBreachService] duplicate suppressed site=#{site.id} signal=#{@signal.id}"
      rescue ActiveRecord::RecordInvalid => e
        Rails.logger.warn "[GeofenceBreachService] skipped site=#{site.id} signal=#{@signal.id}: #{e.message}"
      end

      ServiceResult.success(breaches: breached, count: breached.size)
    end

    private

    def fuse_incident(match)
      Incidents::FusionService.call(match: match)
    rescue StandardError => e
      Rails.logger.error(
        "[GeofenceBreachService] incident fusion failed match=#{match.id} " \
        "site=#{match.site_id} signal=#{match.signal_id} error=#{e.class}: #{e.message}"
      )
      Observability.capture_exception(e, tags: { component: "geofence_breach_fusion" }, throttle_key: "geofence_breach_fusion:error:#{e.class}", throttle_seconds: 300)
    end

    def publish_breach(site:, match:, distance_km:)
      Sse::Broadcaster.instance.publish(
        event: "geofence_breach",
        organization_id: site.organization_id,
        data: {
          site_id:        site.id,
          site_name:      site.name,
          signal_id:      @signal.id,
          signal_type:    @signal.signal_type,
          distance_km:    distance_km.round(1),
          geofence_km:    site.geofence_radius_km,
          match_id:       match.id,
          fired_at:       Time.current.iso8601
        }
      )
    rescue StandardError => e
      Rails.logger.error "[GeofenceBreachService] SSE broadcast failed (non-fatal): #{e.class}: #{e.message}"
    end

    # Confidence ranges from 1.0 (signal at site centre) to near 0 at the boundary.
    def breach_confidence(distance_km, radius_km)
      return 1.0 if radius_km.zero?
      (1.0 - distance_km / radius_km).clamp(0.0, 1.0).round(2)
    end
  end
end
