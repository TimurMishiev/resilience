# Starts the correlation engine background thread after Rails has fully booted.
# Skipped in test mode, rake tasks, and Rails console to keep those environments clean.
unless Rails.env.test? || defined?(Rails::Console) || File.basename($PROGRAM_NAME) == "rake"
  Rails.application.config.after_initialize do
    unless defined?(Rails::Server) || $PROGRAM_NAME.include?("puma") || $PROGRAM_NAME.include?("server")
      Rails.logger.info "[CorrelationEvaluator] skipped outside server process"
      next
    end

    Correlations::BackgroundEvaluator.start
  end
end
