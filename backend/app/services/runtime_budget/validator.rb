module RuntimeBudget
  # Validates the runtime budget contract documented in ADR-011 at
  # boot. The contract spans TWO independent connection pools because
  # production routes SolidQueue to its own database — see
  # config/environments/production.rb:
  #
  #   config.solid_queue.connects_to = { database: { writing: :queue } }
  #
  # and config/database.yml's `queue:` config. SolidQueue dispatchers
  # and workers consume connections from the queue pool, NOT the
  # primary pool that serves the web request path. Conflating them
  # produces wrong required-pool math and misleads operators about
  # which DB_POOL bump fixes which symptom.
  #
  # Pool / consumer mapping:
  #
  #   Primary pool (config: primary_production / database.yml `production`):
  #     - Puma web threads (RAILS_MAX_THREADS)
  #     - Realtime::PostgresRelay LISTEN (1 connection, lifetime of broadcaster)
  #     - + headroom buffer
  #
  #   Queue pool (config: `queue:` in database.yml, db: resilience_production_queue):
  #     - SolidQueue dispatcher (1 connection while polling)
  #     - SolidQueue worker threads (3/process from queue.yml × JOB_CONCURRENCY)
  #     - + headroom buffer
  #
  # Both pools currently inherit the same `pool:` value from the
  # primary_production YAML anchor — a single DB_POOL env var sizes
  # both. If a future change adds an explicit `pool:` override to the
  # queue: section, this validator must be updated to read each pool
  # size independently rather than assuming they're equal.
  #
  # SOLID_QUEUE_IN_PUMA only affects WHERE the queue consumers run
  # (same process vs separate). Pool routing stays the same. When
  # SOLID_QUEUE_IN_PUMA=false, the web process running this validator
  # does not host SQ workers, so the queue pool check is skipped for
  # this process — a sibling SQ process would run its own validator.
  #
  # Fail loud at boot rather than degrade silently under load: a
  # missing DB_POOL bump should kill the deploy, not the first
  # operator session.
  module Validator
    # SolidQueue worker thread count, per worker process. Sourced from
    # config/queue.yml which has `workers: [{ threads: 3 }]`. Must be
    # kept in sync with that file.
    SQ_WORKER_THREADS_PER_PROCESS = 3

    # Primary pool fixed-cost overhead — held continuously while the
    # web process is alive:
    #   1× Realtime::PostgresRelay LISTEN connection (held for the
    #      lifetime of the SSE + telemetry broadcaster threads)
    PRIMARY_FIXED_OVERHEAD = 1

    # Queue pool fixed-cost overhead:
    #   1× SQ dispatcher (polls every 1s; brief checkout per poll, but
    #      reserve worst-case)
    QUEUE_FIXED_OVERHEAD = 1

    HEADROOM = 1

    InsufficientPoolError = Class.new(StandardError)

    Result = Struct.new(
      :solid_queue_in_puma,
      :puma_threads,
      :job_concurrency,
      :primary_required,
      :primary_actual,
      :primary_ok,
      :sq_worker_threads,
      :queue_required,
      :queue_actual,
      :queue_checked,
      :queue_ok,
      :ok,
      :reasoning,
      keyword_init: true
    )

    module_function

    # Performs the budget check. Returns a Result struct on success;
    # raises InsufficientPoolError on failure. Production env only —
    # see #should_validate? for the gate.
    #
    # All inputs (env reads, pool sizes) are passed in so the spec can
    # exercise every branch deterministically. The queue_pool argument
    # is optional because:
    #   - In test/dev, the queue pool may not be wired up.
    #   - When SOLID_QUEUE_IN_PUMA=false, the web process has no
    #     queue consumers and skips the check regardless.
    def validate!(env: ENV, primary_pool: ActiveRecord::Base.connection_pool, queue_pool: nil)
      result = compute(env: env, primary_pool: primary_pool, queue_pool: queue_pool)
      return result if result.ok

      raise InsufficientPoolError, format_error(result)
    end

    def compute(env: ENV, primary_pool: ActiveRecord::Base.connection_pool, queue_pool: nil)
      solid_queue_in_puma = truthy?(env["SOLID_QUEUE_IN_PUMA"])
      puma_threads        = Integer(env.fetch("RAILS_MAX_THREADS", 5))
      job_concurrency     = Integer(env.fetch("JOB_CONCURRENCY", 1))
      primary_actual      = primary_pool.size

      primary_required = puma_threads + PRIMARY_FIXED_OVERHEAD + HEADROOM
      primary_ok       = primary_actual >= primary_required

      # Queue pool only checked when SQ runs in this process AND the
      # caller provides the queue pool. The initializer wires this up
      # for production; specs can opt in/out per case.
      sq_worker_threads = job_concurrency * SQ_WORKER_THREADS_PER_PROCESS
      queue_required    = sq_worker_threads + QUEUE_FIXED_OVERHEAD + HEADROOM
      queue_checked     = solid_queue_in_puma && !queue_pool.nil?
      queue_actual      = queue_pool&.size
      queue_ok          = queue_checked ? (queue_actual >= queue_required) : true

      Result.new(
        solid_queue_in_puma: solid_queue_in_puma,
        puma_threads:        puma_threads,
        job_concurrency:     job_concurrency,
        primary_required:    primary_required,
        primary_actual:      primary_actual,
        primary_ok:          primary_ok,
        sq_worker_threads:   sq_worker_threads,
        queue_required:      queue_required,
        queue_actual:        queue_actual,
        queue_checked:       queue_checked,
        queue_ok:            queue_ok,
        ok:                  primary_ok && queue_ok,
        reasoning:           build_reasoning(
                               puma_threads:        puma_threads,
                               sq_worker_threads:   sq_worker_threads,
                               solid_queue_in_puma: solid_queue_in_puma,
                               queue_checked:       queue_checked,
                             ),
      )
    end

    def should_validate?(env: ENV, rails_env: Rails.env)
      return false unless rails_env == "production"
      # Allow operators to opt out for emergency boots (e.g. recovering
      # a broken deploy from console). Documented in ADR-011.
      !truthy?(env["RUNTIME_BUDGET_SKIP"])
    end

    def truthy?(value)
      %w[1 true TRUE yes YES].include?(value.to_s)
    end

    def build_reasoning(puma_threads:, sq_worker_threads:, solid_queue_in_puma:, queue_checked:)
      primary_parts = ["primary pool: #{puma_threads} Puma threads + #{PRIMARY_FIXED_OVERHEAD} LISTEN + #{HEADROOM} headroom"]
      if queue_checked
        primary_parts << "queue pool: #{sq_worker_threads} SQ worker threads + #{QUEUE_FIXED_OVERHEAD} dispatcher + #{HEADROOM} headroom"
      elsif solid_queue_in_puma
        primary_parts << "queue pool: in-puma but no queue_pool injected — check skipped"
      else
        primary_parts << "queue pool: SQ in separate process — not this process's concern"
      end
      primary_parts.join(" | ")
    end

    def format_error(result)
      lines = ["Runtime budget violated:"]
      unless result.primary_ok
        lines << format("  Primary pool: have %d, need %d (%s).",
                        result.primary_actual,
                        result.primary_required,
                        "#{result.puma_threads} Puma + #{PRIMARY_FIXED_OVERHEAD} LISTEN + #{HEADROOM} headroom")
      end
      if result.queue_checked && !result.queue_ok
        lines << format("  Queue pool: have %d, need %d (%s).",
                        result.queue_actual,
                        result.queue_required,
                        "#{result.sq_worker_threads} SQ workers + #{QUEUE_FIXED_OVERHEAD} dispatcher + #{HEADROOM} headroom")
      end
      lines << "Either increase DB_POOL, add an explicit pool override on the appropriate database in database.yml, " \
               "reduce RAILS_MAX_THREADS / JOB_CONCURRENCY, " \
               "or move SolidQueue to a separate process (SOLID_QUEUE_IN_PUMA=false + bin/jobs in fly.toml)."
      lines << "See docs/adr-011-runtime-budget.md for the contract."
      lines.join("\n")
    end
  end
end
