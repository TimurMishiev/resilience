# Start the asset telemetry simulator background thread on boot.
# Requires TELEMETRY_SIMULATOR_ENABLED=true so synthetic data never appears by
# accident in production-like environments.
unless Rails.env.test? || defined?(Rails::Console) || File.basename($PROGRAM_NAME) == "rake"
  Rails.application.config.after_initialize do
    Telemetry::SimulatorService.boot!
  end
end
