namespace :correlations do
  desc "Audit malformed persisted correlation rules; set DEACTIVATE=1 to disable active malformed rules"
  task audit_unsupported_rules: :environment do
    deactivate = ActiveModel::Type::Boolean.new.cast(ENV["DEACTIVATE"])
    Correlations::UnsupportedRulesAuditService.call(deactivate: deactivate)
  end
end
