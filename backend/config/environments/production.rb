require "active_support/core_ext/integer/time"

Rails.application.configure do
  # Settings specified here will take precedence over those in config/application.rb.

  # Code is not reloaded between requests.
  config.enable_reloading = false

  # Eager load code on boot for better performance and memory savings (ignored by Rake tasks).
  config.eager_load = true

  # Full error reports are disabled.
  config.consider_all_requests_local = false

  # The app shell HTML must be revalidated on each deploy; otherwise browsers can
  # keep a stale index.html that references old hashed chunks and boot a blank app.
  # We trade some static-cache performance for deploy correctness here.
  config.public_file_server.headers = { "cache-control" => "public, max-age=0, must-revalidate" }

  # Enable serving of images, stylesheets, and JavaScripts from an asset server.
  # config.asset_host = "http://assets.example.com"

  # Fly.io terminates TLS at the edge and forwards plain HTTP internally.
  # Telling Rails to assume SSL ensures cookies and redirects use https://.
  # Set ASSUME_SSL=false for local Docker / CI testing over plain HTTP —
  # this disables both assume_ssl AND force_ssl so the app serves plain HTTP
  # without redirecting to https://.
  config.assume_ssl = ENV.fetch("ASSUME_SSL", "true") != "false"

  # Force all access to the app over SSL, use Strict-Transport-Security, and use secure cookies.
  # Fly handles the HTTP→HTTPS redirect at the proxy layer; the ssl_options exclusion
  # prevents a double-redirect loop on the health check endpoint.
  # Gated on assume_ssl so Docker Compose / CI can run over plain HTTP.
  config.force_ssl = config.assume_ssl
  config.ssl_options = { redirect: { exclude: ->(request) { request.path == "/up" } } }

  # Log to STDOUT with the current request id as a default log tag.
  config.log_tags = [ :request_id ]
  config.logger   = ActiveSupport::TaggedLogging.logger(STDOUT)

  # Change to "debug" to log everything (including potentially personally-identifiable information!).
  config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info")

  # Prevent health checks from clogging up the logs.
  config.silence_healthcheck_path = "/up"

  # Don't log any deprecations.
  config.active_support.report_deprecations = false

  # Replace the default in-process memory cache store with a durable alternative.
  config.cache_store = :solid_cache_store

  # Replace the default in-process and non-durable queuing backend for Active Job.
  config.active_job.queue_adapter = :solid_queue
  config.solid_queue.connects_to = { database: { writing: :queue } }

  # Enable locale fallbacks for I18n (makes lookups for any locale fall back to
  # the I18n.default_locale when a translation cannot be found).
  config.i18n.fallbacks = true

  # Do not dump schema after migrations.
  config.active_record.dump_schema_after_migration = false

  # Only use :id for inspections in production.
  config.active_record.attributes_for_inspect = [ :id ]

  # DNS rebinding protection — allowlist the Fly.io hostname and localhost for Docker.
  # The health check path is excluded so Fly's uptime probe is never blocked.
  config.hosts = [
    "resilience-ops.fly.dev",
    "localhost",
    "127.0.0.1",
  ]
  config.host_authorization = { exclude: ->(request) { request.path == "/up" } }
end
