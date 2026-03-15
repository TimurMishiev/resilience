# Start the asset telemetry simulator background thread on boot.
# Skipped in test environment and during rake tasks (non-server processes).
if Rails.env.development? || Rails.env.production?
  Rails.application.config.after_initialize do
    # Only start in the server process — not in rake tasks or the console
    # (detect via the presence of a live Puma/Falcon server thread).
    if defined?(Rails::Server) || $PROGRAM_NAME.include?("puma") || $PROGRAM_NAME.include?("server")
      Rails.logger.info "[Telemetry] Starting simulator..."
      Telemetry::SimulatorService.start!
      Rails.logger.info "[Telemetry] Simulator started."
    end
  end
end
