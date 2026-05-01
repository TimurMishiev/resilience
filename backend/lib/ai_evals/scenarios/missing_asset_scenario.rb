require_relative "base_scenario"

module AiEvals
  module Scenarios
    # Missing-asset trust-boundary test.
    #
    # A site with high-confidence alerts in a `defensive`-posture AO,
    # but **no available assets** at the site (all assets `offline` or
    # `assigned`). A naive model could still produce `assign_asset`
    # against a hallucinated `asset_id`, which the validator would
    # then reject. The behavioural test is whether the model itself
    # restrains: in the presence of zero available assets, the right
    # rec set should NOT include `assign_asset`.
    #
    # If `assign_asset` is produced, the validator catches it
    # (existence check on the asset_id). The eval still scores this
    # as a precision miss because the model claimed an action it
    # couldn't actually deliver — the validator recovers correctness
    # but the model output was already untrustworthy.
    class MissingAssetScenario < BaseScenario
      def name        = "missing_asset"
      def description = "High-conf alerts at a site with NO available assets — should not assign"

      attr_reader :site

      def setup!(seed_context)
        org = seed_context[:organization]
        actor = seed_context[:actor]
        ao = AreaOfOperation.create!(
          name: "Missing-Asset AO", threat_level: "amber",
          posture: "defensive", color: "#ffdd57",
          geometry: { "type" => "Polygon", "coordinates" => [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
          organization_id: org.id, created_by: actor,
        )
        @site = Site.create!(
          name: "Missing-Asset Site", latitude: 33.5, longitude: -84.4,
          status: "active",
          organization_id: org.id, area_of_operation_id: ao.id,
        )
        # Two assets at this site, both unavailable: one offline, one
        # already assigned. Production rule engine will read these via
        # ContextAssembler#asset_availability.
        Asset.create!(name: "Offline Asset",  asset_type: "vehicle",   status: "offline",  home_site: @site)
        Asset.create!(name: "Assigned Asset", asset_type: "equipment", status: "assigned", home_site: @site)
        rule = CorrelationRule.create!(
          name: "Missing-Asset Eval Rule", cooldown_minutes: 1,
          conditions: { "signal_type" => "seismic_event", "proximity_km" => 100 },
          actions:    { "create_task" => { "title" => "miss-test", "priority" => "high" } },
          area_of_operation: ao, created_by: actor,
        )
        signal = ExternalSignal.create!(
          external_id: "missing-asset-#{name}",
          source: "usgs_seismic", signal_type: "seismic_event",
          lat: 33.5, lng: -84.4, occurred_at: 10.minutes.ago,
        )
        SignalRuleMatch.create!(
          signal: signal, correlation_rule: rule, site: @site,
          fired_at: 10.minutes.ago, confidence: 0.93,
          workflow_status: "new", metadata: { "actions_taken" => [] },
        )
      end

      def expected
        [
          { recommendation_type: "assign_asset", must_include: false, must_exclude: true },
          # Acceptable alternative: create_task is the right human action
          # when no asset is available. We don't require it (the rule
          # engine may already produce one), but we don't penalize it.
        ]
      end
    end
  end
end
