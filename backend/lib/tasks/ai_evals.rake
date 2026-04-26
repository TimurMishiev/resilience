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
end
