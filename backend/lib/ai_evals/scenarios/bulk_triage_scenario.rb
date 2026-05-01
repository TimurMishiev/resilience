require_relative "base_scenario"

module AiEvals
  module Scenarios
    # Bulk triage — many fresh unacknowledged alerts at one site.
    #
    # Eight unacknowledged alerts at a single site, none stale (all
    # within the past hour). Above the
    # `ContextAssembler::BULK_TRIAGE_THRESHOLD` (5 alerts at one site).
    # The right behaviour is a `bulk_triage_alerts` recommendation
    # against the site — the operator should be steered toward bulk
    # action rather than 8 individual close/ack recs.
    #
    # Failure modes:
    # - Producing only individual `acknowledge_alert` recs misses the
    #   bulk-triage shape (recall miss).
    # - Producing zero recs against this state is a recall failure on
    #   the alert-volume signal.
    class BulkTriageScenario < BaseScenario
      def name        = "bulk_triage_volume"
      def description = "Eight fresh unacked alerts at one site — should suggest bulk_triage_alerts"

      attr_reader :site

      def setup!(seed_context)
        org = seed_context[:organization]
        actor = seed_context[:actor]
        ao = AreaOfOperation.create!(
          name: "Bulk Triage AO",
          threat_level: "amber",
          posture: "defensive",
          color: "#ffdd57",
          geometry: { "type" => "Polygon", "coordinates" => [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
          organization_id: org.id, created_by: actor,
        )
        @site = Site.create!(
          name: "High-Volume Site",
          latitude: 41.0, longitude: -85.0, status: "active",
          organization_id: org.id, area_of_operation_id: ao.id,
        )
        rule = CorrelationRule.create!(
          name: "Bulk Triage Eval Rule", cooldown_minutes: 1,
          conditions: { "signal_type" => "seismic_event", "proximity_km" => 100 },
          actions:    { "create_task" => { "title" => "bulk-test", "priority" => "normal" } },
          area_of_operation: ao, created_by: actor,
        )
        8.times do |i|
          signal = ExternalSignal.create!(
            external_id: "bulk-eval-#{name}-#{i}",
            source: "usgs_seismic", signal_type: "seismic_event",
            lat: 41.0, lng: -85.0, occurred_at: (i * 5).minutes.ago,
          )
          SignalRuleMatch.create!(
            signal: signal, correlation_rule: rule, site: @site,
            fired_at: (i * 5).minutes.ago, confidence: 0.7 + (i * 0.02),
            workflow_status: "new", metadata: { "actions_taken" => [] },
          )
        end
      end

      def expected
        [
          { recommendation_type: "bulk_triage_alerts", must_include: true,
            entity_matcher: ->(rec) { rec[:affected_entity_type] == "Site" && rec[:affected_entity_id] == @site.id } },
        ]
      end
    end
  end
end
