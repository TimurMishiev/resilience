require_relative "scoring"
require_relative "scenarios/base_scenario"
require_relative "scenarios/routine_ops_scenario"
require_relative "scenarios/stale_alerts_scenario"
require_relative "scenarios/high_threat_ao_scenario"
require_relative "scenarios/observe_posture_restraint_scenario"
require_relative "scenarios/bulk_triage_scenario"
require_relative "scenarios/missing_asset_scenario"

module AiEvals
  # Behavioural eval runner for the recommendation pipeline.
  #
  # Distinct from `Ai::EvalsRunner` (lib/ai/evals_runner.rb), which is a
  # *contract* harness — it asserts the API surface parses correctly.
  # This runner is a *behavioural* harness: it asserts that for a given
  # operational scenario the model produces the *right kind* of
  # recommendation against the *right entity*. The two are
  # complementary; contract evals catch SDK / parsing breakage,
  # behavioural evals catch reasoning / restraint regressions.
  #
  # Per-scenario flow:
  #
  #   1. Wipe the eval-test database to a known empty state.
  #   2. Run scenario.setup! to populate the operational state.
  #   3. Invoke `Recommendations::GeneratorService` (the real
  #      production path including LlmEnricher → Anthropic call →
  #      Validator).
  #   4. Score the persisted recommendations against the scenario's
  #      labelled expectations via `AiEvals::Scoring`.
  #   5. Capture cost (token totals) from `Metrics::Recorder`.
  #
  # Aggregate scoring is micro-averaged so every expectation
  # contributes equally regardless of which scenario it came from.
  #
  # Like the contract runner, this is gated on ANTHROPIC_API_KEY +
  # an explicit rake-task argument. Without those it cleanly skips,
  # so the workflow can be merged before API credit is restored
  # (Tranche C ships dormant and activates the moment credit returns).
  class RecommendationBehaviorRunner
    DEFAULT_SCENARIOS = [
      Scenarios::RoutineOpsScenario,
      Scenarios::StaleAlertsScenario,
      Scenarios::HighThreatAoScenario,
      Scenarios::ObservePostureRestraintScenario,
      Scenarios::BulkTriageScenario,
      Scenarios::MissingAssetScenario,
    ].freeze

    def initialize(scenario_classes: DEFAULT_SCENARIOS, results_dir: nil)
      @scenario_classes = scenario_classes
      @results_dir = results_dir || ENV.fetch(
        "AI_EVALS_RESULTS_DIR",
        Rails.root.join("tmp", "ai_evals_behavior").to_s,
      )
      FileUtils.mkdir_p(@results_dir)
      @timestamp = Time.current.utc.strftime("%Y-%m-%dT%H-%M-%SZ")
    end

    # Returns 0 on success, 1 on per-scenario failures or contract
    # break. Caller (rake) translates to process exit.
    def run!
      Metrics::Recorder.reset!

      scenario_scores = @scenario_classes.map do |klass|
        run_scenario(klass.new)
      end

      aggregate = Scoring.aggregate(scenario_scores)
      cost_payload = capture_cost

      write_json(scenario_scores: scenario_scores, aggregate: aggregate, cost: cost_payload)
      write_summary(scenario_scores: scenario_scores, aggregate: aggregate, cost: cost_payload)

      # Treat as failure if recall < 0.5 (model is missing the
      # majority of expected behaviours) OR precision < 0.7 (model is
      # generating clearly wrong recs against multiple scenarios).
      # Thresholds are deliberately permissive on the first run; the
      # trend over weeks is the operationally meaningful signal, not
      # the absolute number on day one.
      return 1 if aggregate[:recall] < 0.5 || aggregate[:precision] < 0.7

      0
    end

    private

    def run_scenario(scenario)
      reset_eval_state!

      org   = Organization.create!(name: "AI Eval Org #{scenario.name}", slug: "ai-eval-#{scenario.name}-#{SecureRandom.hex(3)}")
      actor = User.create!(email: "ai-eval-#{scenario.name}-#{SecureRandom.hex(3)}@eval.local", role: "admin", password: "ai-eval-#{SecureRandom.hex(8)}")

      scenario.setup!(organization: org, actor: actor)

      result = Recommendations::GeneratorService.call(organization_id: org.id)
      raise ContractFailure, "GeneratorService failed: #{result.errors&.join(', ')}" unless result.success?

      # The eval sandbox is hard-reset before every scenario, then seeded
      # with exactly one org. Recommendations do not carry a persisted
      # `organization_id`, so the correct slice is "all recs created in
      # this fresh single-tenant run", not a nonexistent tenant column.
      recs = Recommendation.all.map do |r|
        {
          recommendation_type:  r.recommendation_type,
          tier:                 r.tier,
          affected_entity_type: r.affected_entity_type,
          affected_entity_id:   r.affected_entity_id,
          confidence:           r.confidence,
        }
      end

      Scoring.score_scenario(scenario: scenario, recommendations: recs).merge(
        llm_recs: recs.count { |r| r[:tier] == "llm" },
        rule_recs: recs.count { |r| r[:tier] == "rule" },
      )
    rescue SafetyViolation
      # Safety gates must abort the whole run, not be silently
      # demoted to a per-scenario failure. If either gate fires
      # (wrong DB or missing opt-in env), the developer needs to
      # see the message NOW and the run must stop. Swallowing this
      # in the broad StandardError rescue below would still log the
      # gate's message but produce six fake "failed" scenarios and
      # let the workflow keep going — exactly the visibility loss
      # the gate is supposed to prevent.
      raise
    rescue StandardError => e
      {
        scenario:    scenario.name,
        description: scenario.description,
        error:       "#{e.class}: #{e.message}",
        recall:      0.0,
        precision:   0.0,
        include:     { satisfied: 0, total: 0, results: [] },
        exclude:     { satisfied: 0, total: 0, results: [] },
      }
    end

    # Resets the database to the eval baseline. Destructive — TRUNCATE
    # CASCADE on every operational table. Two independent safety gates,
    # both required:
    #
    #   1. The database name must end in `_test` (CI workflow points at
    #      `resilience_test`; local dev DBs are `resilience_development`
    #      and won't pass).
    #   2. AI_EVALS_ALLOW_DESTRUCTIVE_RESET=1 must be set explicitly.
    #      The CI workflow sets it; locally it's never set, so even a
    #      developer who manually targets the test DB still has to opt
    #      in deliberately.
    #
    # The first time this safety was missing, an accidental local run
    # truncated my development DB. Two independent gates prevent that
    # from being possible again.
    def reset_eval_state!
      db_name = ActiveRecord::Base.connection.current_database.to_s
      unless db_name.end_with?("_test")
        raise SafetyViolation, "[ai:behavior_evals] refusing to truncate database '#{db_name}' — name must end in '_test'. Point at the test DB or set DATABASE_URL accordingly."
      end
      unless ENV["AI_EVALS_ALLOW_DESTRUCTIVE_RESET"] == "1"
        raise SafetyViolation, "[ai:behavior_evals] refusing destructive reset — set AI_EVALS_ALLOW_DESTRUCTIVE_RESET=1 to opt in. The CI workflow sets it; locally you must do so explicitly."
      end

      tables = %w[
        recommendations signal_rule_matches external_signals correlation_rules
        assets tasks sites areas_of_operation users organizations
      ]
      ActiveRecord::Base.connection.execute("TRUNCATE TABLE #{tables.join(', ')} RESTART IDENTITY CASCADE")
    end

    SafetyViolation = Class.new(StandardError)

    def capture_cost
      Metrics::Recorder.snapshot!
      OperationalStatus.find_by(category: "metrics", key: "ai_usage")&.payload || {}
    end

    def write_json(scenario_scores:, aggregate:, cost:)
      payload = {
        timestamp:        @timestamp,
        scenarios:        scenario_scores,
        aggregate:        aggregate,
        cost:             cost,
        anthropic_model:  Recommendations::LlmEnricher::DEFAULT_MODEL,
      }
      File.write(File.join(@results_dir, "behavior-#{@timestamp}.json"), JSON.pretty_generate(payload))
    end

    def write_summary(scenario_scores:, aggregate:, cost:)
      step_summary = ENV["GITHUB_STEP_SUMMARY"]
      io = step_summary ? File.open(step_summary, "a") : $stdout

      io.puts "## AI Behavioural Evaluation"
      io.puts ""
      io.puts "Recall: **#{(aggregate[:recall] * 100).round(1)}%** (#{aggregate[:include_hits]}/#{aggregate[:include_total]} expectations satisfied)"
      io.puts "Precision (restraint): **#{(aggregate[:precision] * 100).round(1)}%** (#{aggregate[:exclude_hits]}/#{aggregate[:exclude_total]} avoided)"
      io.puts ""
      io.puts "| Scenario | Recall | Precision | LLM recs | Rule recs |"
      io.puts "|---|---|---|---|---|"
      scenario_scores.each do |s|
        io.puts "| #{s[:scenario]} | #{format_pct(s[:recall])} | #{format_pct(s[:precision])} | #{s[:llm_recs] || 0} | #{s[:rule_recs] || 0} |"
      end
      io.puts ""
      if cost["total_input_tokens"] || cost[:total_input_tokens]
        io.puts "Token totals (input / output): #{cost['total_input_tokens'] || cost[:total_input_tokens]} / #{cost['total_output_tokens'] || cost[:total_output_tokens]}"
      end
      io.close if step_summary
    end

    def format_pct(v)
      "#{(v * 100).round(1)}%"
    end

    ContractFailure = Class.new(StandardError)
  end
end
