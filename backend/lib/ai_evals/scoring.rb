module AiEvals
  # Pure scoring math for behavioural eval results.
  #
  # Given a scenario's labelled expectations and the actual recommendation
  # output, returns:
  #
  #   - per-expectation hits / misses / spurious
  #   - per-scenario recall, precision
  #   - aggregate (micro-averaged) recall, precision over all scenarios
  #
  # No I/O, no Anthropic, no DB. Trivially testable.
  module Scoring
    module_function

    # Score one scenario against its actual output.
    #
    # @param scenario [Scenarios::BaseScenario]
    # @param recommendations [Array<Hash>] the actual recs the model
    #   produced, in the same shape as Recommendations::Validator input
    #   (symbol keys: :recommendation_type, :affected_entity_type,
    #   :affected_entity_id, etc.)
    # @return [Hash]
    def score_scenario(scenario:, recommendations:)
      include_expectations = scenario.expected.select { |e| e[:must_include] }
      exclude_expectations = scenario.expected.select { |e| e[:must_exclude] }

      include_results = include_expectations.map do |exp|
        matched = recommendations.any? { |rec| matches?(rec, exp) }
        { expectation: exp, satisfied: matched }
      end

      exclude_results = exclude_expectations.map do |exp|
        spurious = recommendations.any? { |rec| matches?(rec, exp) }
        { expectation: exp, satisfied: !spurious }
      end

      include_hits = include_results.count { |r| r[:satisfied] }
      include_total = include_results.size
      exclude_hits = exclude_results.count { |r| r[:satisfied] }
      exclude_total = exclude_results.size

      {
        scenario:        scenario.name,
        description:     scenario.description,
        recommendations: recommendations.size,
        include:         { satisfied: include_hits, total: include_total, results: include_results },
        exclude:         { satisfied: exclude_hits, total: exclude_total, results: exclude_results },
        # Recall: of the must_include expectations, what fraction did
        # the model produce? Vacuously 1.0 when no must_include exists.
        recall:          include_total.zero? ? 1.0 : include_hits.to_f / include_total,
        # Precision (here: restraint score) — of the must_exclude
        # expectations, what fraction did the model correctly NOT
        # produce? Vacuously 1.0 when no must_exclude exists.
        precision:       exclude_total.zero? ? 1.0 : exclude_hits.to_f / exclude_total,
      }
    end

    # Aggregate across many scenario results. Micro-averaged: every
    # expectation contributes equally regardless of which scenario it
    # came from.
    def aggregate(scenario_scores)
      include_hits  = scenario_scores.sum { |s| s[:include][:satisfied] }
      include_total = scenario_scores.sum { |s| s[:include][:total] }
      exclude_hits  = scenario_scores.sum { |s| s[:exclude][:satisfied] }
      exclude_total = scenario_scores.sum { |s| s[:exclude][:total] }

      {
        scenarios_run: scenario_scores.size,
        recall:        include_total.zero? ? 1.0 : include_hits.to_f / include_total,
        precision:     exclude_total.zero? ? 1.0 : exclude_hits.to_f / exclude_total,
        include_hits:  include_hits,
        include_total: include_total,
        exclude_hits:  exclude_hits,
        exclude_total: exclude_total,
      }
    end

    # A single rec matches an expectation when:
    #   - recommendation_type matches the expectation's type, AND
    #   - if entity_matcher is supplied, it returns true for the rec
    def matches?(rec, expectation)
      return false unless rec[:recommendation_type] == expectation[:recommendation_type]
      return true unless expectation[:entity_matcher]
      expectation[:entity_matcher].call(rec)
    end
  end
end
