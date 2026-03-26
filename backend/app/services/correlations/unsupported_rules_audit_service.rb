module Correlations
  class UnsupportedRulesAuditService < ApplicationService
    def initialize(deactivate: false, io: $stdout)
      @deactivate = deactivate
      @io = io
    end

    def call
      malformed = []
      deactivated_ids = []

      CorrelationRule.find_each do |rule|
        next if rule.supported_condition_shape?

        deactivated = false
        if @deactivate && rule.is_active?
          rule.update_columns(is_active: false, updated_at: Time.current)
          rule.reload
          deactivated = true
          deactivated_ids << rule.id
        end

        record = {
          rule_id: rule.id,
          name: rule.name,
          active: rule.is_active,
          deactivated: deactivated,
        }
        malformed << record
        emit_record(record)
      end

      emit_summary(malformed_count: malformed.size, deactivated_count: deactivated_ids.size)

      ServiceResult.success(
        malformed_count: malformed.size,
        deactivated_count: deactivated_ids.size,
        malformed_rules: malformed,
        deactivated_rule_ids: deactivated_ids,
      )
    end

    private

    def emit_record(record)
      @io.puts([
        "[UnsupportedRuleAudit]",
        "rule=#{record[:rule_id]}",
        "name=#{record[:name].inspect}",
        "active=#{record[:active]}",
        "deactivated=#{record[:deactivated]}",
      ].join(" "))
    end

    def emit_summary(malformed_count:, deactivated_count:)
      @io.puts([
        "[UnsupportedRuleAudit]",
        "malformed_count=#{malformed_count}",
        "deactivated_count=#{deactivated_count}",
      ].join(" "))
    end
  end
end
