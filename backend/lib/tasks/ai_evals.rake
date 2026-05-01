require Rails.root.join("lib", "ai", "evals_runner") if defined?(Rails)

namespace :ai do
  # Live-model AI evaluation lane.
  #
  # Hits the real Anthropic API for each model-call surface (task filter,
  # signal filter, ontology query, summary), captures latency / tokens /
  # estimated cost via Ai::AnthropicClient → Metrics::Recorder, and writes
  # a JSON artifact + a markdown summary to GITHUB_STEP_SUMMARY when set.
  #
  # ── Safety contract (default-skip, explicit opt-in via rake argument) ──
  #
  # The argument is required because env vars are NOT a reliable opt-in
  # for this app: config/boot.rb calls Dotenv.overwrite(...), which
  # re-applies .env values over any shell export — including
  # ANTHROPIC_API_KEY. A developer who blanks the key in the shell can
  # still find it repopulated by boot. Rake task arguments are immune
  # to dotenv, so they are the only signal we trust here.
  #
  #   bundle exec rake ai:live_evals          → SKIP (safe default)
  #   bundle exec rake "ai:live_evals[run]"   → RUN
  #
  # The CI workflow at .github/workflows/ai-evals-live.yml passes [run]
  # explicitly. Locally the task always skips unless the developer
  # types the argument — there is no way to silently enable it via
  # env vars or .env edits.
  #
  # As a second-layer gate, the task also skips when ANTHROPIC_API_KEY
  # is missing, so a CI run with the [run] argument but an unset
  # secret exits cleanly instead of issuing empty-credential calls.
  desc "Live-model AI evaluation lane (real Anthropic calls). Pass [run] to execute; default is skip."
  task :live_evals, [:mode] => :environment do |_t, args|
    mode = args[:mode].to_s

    if mode != "run"
      puts "[ai:live_evals] skipped (default-safe). To execute live calls, run: bundle exec rake \"ai:live_evals[run]\""
      next
    end

    if ENV["ANTHROPIC_API_KEY"].to_s.strip.empty?
      puts "[ai:live_evals] ANTHROPIC_API_KEY not set — skipping live evaluation."
      next
    end

    exit_code = Ai::EvalsRunner.new.run!
    exit(exit_code) unless exit_code.zero?
  end

  # Behavioural eval lane (Tranche C of the 87→90 plan).
  #
  # Distinct from `ai:live_evals` (the contract harness above): this
  # task asserts that for a given operational scenario the model
  # produces the *right kind* of recommendation against the *right
  # entity*. Scoring is precision/recall over a frozen set of human-
  # labelled scenarios. See backend/lib/ai_evals/ + docs/ai-evals/
  # for design and operating notes.
  #
  # Same default-skip + opt-in contract as ai:live_evals, for the
  # same reason: dotenv re-applies env values at boot, so rake-task
  # argument is the only reliable opt-in signal.
  #
  #   bundle exec rake ai:behavior_evals          → SKIP
  #   bundle exec rake "ai:behavior_evals[run]"   → RUN
  #
  # Ships dormant: until ANTHROPIC_API_KEY is present in CI, this
  # exits cleanly without making any network calls. The moment the
  # secret is restored, the next weekly cron run produces the first
  # trend point.
  desc "Behavioural AI eval lane (real Anthropic calls). Pass [run] to execute; default is skip."
  task :behavior_evals, [:mode] => :environment do |_t, args|
    mode = args[:mode].to_s

    if mode != "run"
      puts "[ai:behavior_evals] skipped (default-safe). To execute live calls, run: bundle exec rake \"ai:behavior_evals[run]\""
      next
    end

    if ENV["ANTHROPIC_API_KEY"].to_s.strip.empty?
      puts "[ai:behavior_evals] ANTHROPIC_API_KEY not set — skipping behavioural evaluation."
      next
    end

    require Rails.root.join("lib", "ai_evals", "recommendation_behavior_runner")
    exit_code = AiEvals::RecommendationBehaviorRunner.new.run!
    exit(exit_code) unless exit_code.zero?
  end
end
