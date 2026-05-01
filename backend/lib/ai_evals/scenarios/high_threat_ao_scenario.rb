require_relative "base_scenario"

module AiEvals
  module Scenarios
    # High-threat AO — `flag_site` trigger.
    #
    # One AO at threat_level "red" with a "weapons_free" posture, holding
    # a single site with multiple recent high-confidence alerts. The
    # right behaviour is `flag_site` against that site (operator should
    # be drawn to it specifically). `escalate_incident` is also
    # acceptable if an Incident has been fused. Failure mode: producing
    # only routine `acknowledge_alert` recs misses the threat-level
    # signal entirely.
    class HighThreatAoScenario < BaseScenario
      def name        = "high_threat_ao_red_weapons_free"
      def description = "Red threat level, weapons-free posture, recent high-conf alerts — should flag site"

      attr_reader :site, :ao

      def setup!(seed_context)
        org = seed_context[:organization]
        actor = seed_context[:actor]
        @ao = AreaOfOperation.create!(
          name: "Red Weapons-Free AO",
          threat_level: "red",
          posture: "weapons_free",
          color: "#ff3860",
          geometry: { "type" => "Polygon", "coordinates" => [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
          organization_id: org.id,
          created_by: actor,
        )
        @site = Site.create!(
          name: "Forward Threat Site",
          latitude: 36.5, longitude: -118.2, status: "active",
          organization_id: org.id, area_of_operation_id: @ao.id,
        )
        rule = CorrelationRule.create!(
          name: "High Threat Eval Rule",
          cooldown_minutes: 1,
          conditions: { "signal_type" => "seismic_event", "proximity_km" => 100 },
          actions:    { "create_task" => { "title" => "threat-test", "priority" => "high" } },
          area_of_operation: @ao,
          created_by: actor,
        )
        # 3 recent high-confidence alerts within the last hour.
        3.times do |i|
          signal = ExternalSignal.create!(
            external_id: "threat-eval-#{name}-#{i}",
            source: "usgs_seismic", signal_type: "seismic_event",
            lat: 36.5, lng: -118.2, occurred_at: (i * 15).minutes.ago,
          )
          SignalRuleMatch.create!(
            signal: signal, correlation_rule: rule, site: @site,
            fired_at: (i * 15).minutes.ago, confidence: 0.92,
            workflow_status: "new", metadata: { "actions_taken" => [] },
          )
        end
      end

      def expected
        [
          # Must surface this site at high tier somehow.
          { recommendation_type: "flag_site", must_include: true,
            entity_matcher: ->(rec) { rec[:affected_entity_type] == "Site" && rec[:affected_entity_id] == @site.id } },
        ]
      end
    end
  end
end
