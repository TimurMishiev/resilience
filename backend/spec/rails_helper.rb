# This file is copied to spec/ when you run 'rails generate rspec:install'
require 'spec_helper'
ENV['RAILS_ENV'] ||= 'test'
require_relative '../config/environment'
# Prevent database truncation if the environment is production
abort("The Rails environment is running in production mode!") if Rails.env.production?
# Uncomment the line below in case you have `--require rails_helper` in the `.rspec` file
# that will avoid rails generators crashing because migrations haven't been run yet
# return unless Rails.env.test?
require 'rspec/rails'
# Add additional requires below this line. Rails is not loaded until this point!

# Requires supporting ruby files with custom matchers and macros, etc, in
# spec/support/ and its subdirectories. Files matching `spec/**/*_spec.rb` are
# run as spec files by default. This means that files in spec/support that end
# in _spec.rb will both be required and run as specs, causing the specs to be
# run twice. It is recommended that you do not name files matching this glob to
# end with _spec.rb. You can configure this pattern with the --pattern
# option on the command line or in ~/.rspec, .rspec or `.rspec-local`.
#
Rails.root.glob('spec/support/**/*.rb').sort_by(&:to_s).each { |f| require f }

# Checks for pending migrations and applies them before tests are run.
# If you are not using ActiveRecord, you can remove these lines.
begin
  ActiveRecord::Migration.maintain_test_schema!
rescue ActiveRecord::PendingMigrationError => e
  abort e.to_s.strip
end
RSpec.configure do |config|
  config.include FactoryBot::Syntax::Methods
  config.include ActiveSupport::Testing::TimeHelpers

  config.use_transactional_fixtures = false

  config.before(:suite) do
    DatabaseCleaner.strategy = :transaction
    DatabaseCleaner.clean_with(:truncation, except: %w[spatial_ref_sys])

    # Telemetry readings is a date-partitioned table. The migration only
    # creates partitions for the legacy-data window; tests that insert at
    # Time.current would fail with "no partition of relation
    # telemetry_readings found for row" the moment the suite is run after
    # the last migration-created partition expires (manifested in CI
    # daily after 2026-04-30). Ensure today + lookahead is always present.
    Telemetry::PartitionManager.ensure_window!(Time.current) if defined?(Telemetry::PartitionManager)
  end

  config.around(:each) do |example|
    DatabaseCleaner.cleaning { example.run }
  end

  # Isolate Ai::CircuitBreaker state between examples. Without this, a prior
  # example that opened the breaker leaks into the next and causes
  # order-dependent failures across llm_enricher / summary / filter /
  # ontology_query specs (the service short-circuits before even calling
  # the mocked Anthropic client).
  #
  # In test env Rails.cache is NullStore, so the breaker uses its own
  # class-level MemoryStore fallback (circuit_breaker.rb:68-71). Clearing
  # Rails.cache alone is a no-op; we must clear the breaker's own store.
  config.before(:each) do
    Rails.cache.clear
    Ai::CircuitBreaker::KNOWN_SERVICES.each do |service|
      Ai::CircuitBreaker.record_success(service: service)
    end
  end

  # You can uncomment this line to turn off ActiveRecord support entirely.
  # config.use_active_record = false

  # RSpec Rails uses metadata to mix in different behaviours to your tests,
  # for example enabling you to call `get` and `post` in request specs. e.g.:
  #
  #     RSpec.describe UsersController, type: :request do
  #       # ...
  #     end
  #
  # The different available types are documented in the features, such as in
  # https://rspec.info/features/7-1/rspec-rails
  #
  # You can also this infer these behaviours automatically by location, e.g.
  # /spec/models would pull in the same behaviour as `type: :model` but this
  # behaviour is considered legacy and will be removed in a future version.
  #
  # To enable this behaviour uncomment the line below.
  # config.infer_spec_type_from_file_location!

  # Filter lines from Rails gems in backtraces.
  config.filter_rails_from_backtrace!
  # arbitrary gems may also be filtered via:
  # config.filter_gems_from_backtrace("gem name")
end
