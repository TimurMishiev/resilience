module AiEvals
  module Scenarios
    # Base shape of a frozen behavioural scenario.
    #
    # Each subclass is a snapshot of operational state plus a human-labelled
    # set of *expected* recommendation properties. The behavioural runner
    # exercises the production `Recommendations::GeneratorService` against
    # the scenario's seeded DB state, then scores the actual output against
    # the labelled expectations.
    #
    # Why per-scenario subclasses rather than a YAML/JSON catalogue:
    # operational state is a graph (sites, signals, AOs, postures, tasks),
    # not a flat record. Building it programmatically keeps the assertions
    # next to the data they describe and lets the scenarios use the same
    # factories the test suite already trusts.
    #
    # The `expected` array is a list of expectation entries. Each entry has:
    #
    #   - `recommendation_type:` — one of Recommendation::VALID_TYPES
    #   - `must_include:` (default true) — the model MUST produce at least
    #     one rec matching this entry (counts toward recall)
    #   - `entity_matcher:` (optional) — a Proc(rec) → Boolean that
    #     constrains which row the rec must target (e.g. specifically
    #     `flag_site` for the high-threat site, not any site)
    #   - `must_exclude:` (default false) — the model MUST NOT produce a
    #     rec matching this entry (counts toward precision; e.g. "no
    #     `assign_asset` because no asset is available")
    #
    # Scoring (per scenario):
    #   recall    = matched(must_include) / total(must_include)
    #   precision = 1 - matched(must_exclude) / total(must_exclude)
    #               (1.0 when no must_exclude expectations, since vacuous)
    #
    # Aggregate across scenarios: micro-average over all expectations.
    class BaseScenario
      # Subclasses must implement:
      #   #name           — short human label (e.g. "routine_ops")
      #   #description    — one-line description of the operational shape
      #   #setup!(seed_context) — yields the actor + organization the runner
      #                            should use; populates DB state.
      #   #expected       — array of expectation hashes (see above)
      #
      # The base class only enforces the contract; it has no behaviour
      # of its own.
      def name
        raise NotImplementedError
      end

      def description
        raise NotImplementedError
      end

      def setup!(seed_context)
        raise NotImplementedError
      end

      def expected
        raise NotImplementedError
      end
    end
  end
end
