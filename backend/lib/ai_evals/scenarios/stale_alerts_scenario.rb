require_relative "base_scenario"

module AiEvals
  module Scenarios
    # Stale alerts — the canonical "close_stale_alert" trigger.
    #
    # One site with two unacknowledged alerts older than 4 hours
    # (`ContextAssembler::STALE_ALERT_HOURS`). The right behaviour is to
    # produce at least one `close_stale_alert` or `acknowledge_alert` rec
    # against the stale alert(s). Producing nothing here is a recall miss
    # — the operator depends on the system surfacing this kind of drift.
    class StaleAlertsScenario < BaseScenario
      def name        = "stale_alerts"
      def description = "One site, two unacknowledged alerts >4h old — should surface close/ack recs"

      attr_reader :site, :stale_alerts

      def setup!(seed_context)
        org = seed_context[:organization]
        actor = seed_context[:actor]
        ao = AreaOfOperation.create!(
          name: "Stale AO",
          threat_level: "amber",
          posture: "defensive",
          color: "#ffdd57",
          geometry: { "type" => "Polygon", "coordinates" => [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
          organization_id: org.id,
          created_by: actor,
        )
        @site = Site.create!(
          name: "Stale Alert Site",
          latitude: 38.0, longitude: -77.0, status: "active",
          organization_id: org.id, area_of_operation_id: ao.id,
        )

        # Build two stale unacknowledged alerts (>4h old). Use the
        # production model directly so the eval exercises the real
        # ContextAssembler shape rather than a mocked snapshot.
        rule = CorrelationRule.create!(
          name: "Stale Alert Test Rule",
          cooldown_minutes: 60,
          conditions: { "signal_type" => "seismic_event", "proximity_km" => 100 },
          actions:    { "create_task" => { "title" => "stale-test", "priority" => "normal" } },
          area_of_operation: ao,
          created_by: actor,
        )
        @stale_alerts = 2.times.map do |i|
          signal = ExternalSignal.create!(
            external_id: "stale-eval-#{name}-#{i}",
            source: "usgs_seismic", signal_type: "seismic_event",
            lat: 38.0, lng: -77.0,
            occurred_at: 6.hours.ago,
          )
          SignalRuleMatch.create!(
            signal: signal, correlation_rule: rule, site: @site,
            fired_at: 6.hours.ago, confidence: 0.85,
            workflow_status: "new",
            metadata: { "actions_taken" => [] },
          )
        end
      end

      def expected
        [
          { recommendation_type: "close_stale_alert",  must_include: true },
          { recommendation_type: "acknowledge_alert",  must_include: true },
        ]
      end
    end
  end
end
