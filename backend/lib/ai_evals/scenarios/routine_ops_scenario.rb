require_relative "base_scenario"

module AiEvals
  module Scenarios
    # Routine operations — nothing alarming.
    #
    # Three sites with green AO postures, low alert volume, no stale alerts,
    # no degraded feeds. The right model behaviour is to NOT produce
    # high-tier recommendations; spurious "escalate_incident" or
    # "flag_site" recommendations against this state are precision misses.
    #
    # This is the calibration baseline — the hardest test for an LLM is
    # restraint when nothing is wrong.
    class RoutineOpsScenario < BaseScenario
      def name        = "routine_ops"
      def description = "Three sites, green postures, low alert volume — no high-tier action warranted"

      attr_reader :sites

      def setup!(seed_context)
        org = seed_context[:organization]
        actor = seed_context[:actor]
        @sites = 3.times.map do |i|
          ao = AreaOfOperation.create!(
            name: "Routine AO #{i + 1}",
            description: "Routine ops scenario AO",
            threat_level: "green",
            posture: "observe",
            color: "#23d160",
            geometry: { "type" => "Polygon", "coordinates" => [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
            organization_id: org.id,
            created_by: actor,
          )
          Site.create!(
            name: "Routine Site #{i + 1}",
            latitude: 35.0 + i * 0.1,
            longitude: -100.0 + i * 0.1,
            status: "active",
            organization_id: org.id,
            area_of_operation_id: ao.id,
          )
        end
      end

      def expected
        [
          # The model MUST NOT escalate or flag against routine state.
          # Both of these would be high-confidence operator-visible
          # actions; producing them here is a precision failure.
          { recommendation_type: "escalate_incident", must_include: false, must_exclude: true },
          { recommendation_type: "flag_site",         must_include: false, must_exclude: true },
        ]
      end
    end
  end
end
