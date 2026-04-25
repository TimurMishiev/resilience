# This configuration file will be evaluated by Puma. The top-level methods that
# are invoked here are part of Puma's configuration DSL. For more information
# about methods provided by the DSL, see https://puma.io/puma/Puma/DSL.html.
#
# Puma starts a configurable number of processes (workers) and each process
# serves each request in a thread from an internal thread pool.
#
# You can control the number of workers using ENV["WEB_CONCURRENCY"]. You
# should only set this value when you want to run 2 or more workers. The
# default is already 1. You can set it to `auto` to automatically start a worker
# for each available processor.
#
# The ideal number of threads per worker depends both on how much time the
# application spends waiting for IO operations and on how much you wish to
# prioritize throughput over latency.
#
# As a rule of thumb, increasing the number of threads will increase how much
# traffic a given process can handle (throughput), but due to CRuby's
# Global VM Lock (GVL) it has diminishing returns and will degrade the
# response time (latency) of the application.
#
# The default is set to 3 threads as it's deemed a decent compromise between
# throughput and latency for the average Rails application.
#
# Any libraries that use a connection pool or another resource pool should
# be configured to provide at least as many connections as the number of
# threads. This includes Active Record's `pool` parameter in `database.yml`.
#
# ── Runtime budget contract (ADR-011) ────────────────────────────────────────
# Two independent connection pools must be sized correctly:
#   Primary pool: RAILS_MAX_THREADS + LISTEN + headroom = 22 (with RAILS_MAX_THREADS=20)
#   Queue pool:   JOB_CONCURRENCY × 3 + dispatcher + headroom = 5 (with JOB_CONCURRENCY=1)
# SolidQueue routes its connections to the :queue pool via
# config/environments/production.rb's `solid_queue.connects_to` — it does NOT
# share the primary pool with Puma. Both pools currently inherit `pool:` from
# the primary_production YAML anchor, so a single DB_POOL satisfies both.
# The contract is enforced at boot by config/initializers/runtime_budget.rb;
# math + decision gate (light vs heavy isolation) + emergency override are
# documented in docs/adr-011-runtime-budget.md.
#
# ── SSE thread budget ────────────────────────────────────────────────────────
# SSE (Server-Sent Events) streams permanently occupy a Puma thread for their
# entire lifetime — they never return the thread to the pool while connected.
# This makes the thread pool the hard capacity ceiling for concurrent SSE clients.
#
# Constraint chain (production):
#   RAILS_MAX_THREADS        = 20
#   DB_POOL                  = (implicit) RAILS_MAX_THREADS + 5 = 25
#   SSE_MAX_STREAMS_PER_USER = 4
#   SSE_MAX_STREAMS_PER_IP   = 12
#   Fly hard_limit           = 25 connections (HTTP), enforced at the LB
#
# At full SSE occupancy (12 streams) → 8 threads remain for API calls.
#
# Local/default budget (RAILS_MAX_THREADS=32):
#   At full SSE occupancy (12 streams) → 20 threads remain for API calls.
#
# Enforcement: Sse::StreamAdmission uses a PostgreSQL advisory lock + lease
# table (sse_stream_leases) to atomically admit or deny stream requests.
#
# To tune: keep SSE_MAX_STREAMS_PER_IP < (RAILS_MAX_THREADS - headroom),
# where headroom is the number of threads you want available for API calls.
# A minimum headroom of 4–8 threads is recommended for interactive workloads.
threads_count = ENV.fetch("RAILS_MAX_THREADS", 32)
threads threads_count, threads_count

# worker_timeout applies in cluster mode (WEB_CONCURRENCY > 1). Set it high
# enough to accommodate PDF export and Anthropic API calls, which can take
# 20–60 s under load. Override via PUMA_WORKER_TIMEOUT env var.
worker_timeout ENV.fetch("PUMA_WORKER_TIMEOUT", 300).to_i

# Specifies the `port` that Puma will listen on to receive requests; default is 3000.
port ENV.fetch("PORT", 3000)

# Allow puma to be restarted by `bin/rails restart` command.
plugin :tmp_restart

# Run the Solid Queue supervisor inside of Puma for single-server deployments.
plugin :solid_queue if ENV["SOLID_QUEUE_IN_PUMA"]

# Specify the PID file. Defaults to tmp/pids/server.pid in development.
# In other environments, only set the PID file if requested.
pidfile ENV["PIDFILE"] if ENV["PIDFILE"]
