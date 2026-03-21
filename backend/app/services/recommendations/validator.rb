module Recommendations
  # Validates recommendation attribute hashes before they are persisted.
  # For LLM-produced recommendations this includes entity ID verification
  # against the live database — hallucinated IDs are rejected.
  class Validator < ApplicationService
    ENTITY_CLASSES = {
      "Site"             => Site,
      "Incident"         => Incident,
      "SignalRuleMatch"  => SignalRuleMatch,
      "Task"             => Task,
    }.freeze

    def initialize(recommendations:)
      @recs = recommendations
    end

    def call
      valid   = []
      invalid = []

      @recs.each do |rec|
        errors = validate(rec)
        if errors.empty?
          valid << rec
        else
          invalid << { rec: rec, errors: errors }
          Rails.logger.debug "[Validator] rejected recommendation: #{errors.join(', ')}"
        end
      end

      ServiceResult.success(valid: valid, invalid: invalid)
    end

    private

    def validate(rec)
      errors = []

      errors << "invalid recommendation_type" unless Recommendation::VALID_TYPES.include?(rec[:recommendation_type])
      errors << "invalid tier"                unless Recommendation::VALID_TIERS.include?(rec[:tier])
      errors << "confidence out of range"     unless (0.0..1.0).cover?(rec[:confidence].to_f)
      errors << "rationale blank"             if rec[:rationale].blank?
      errors << "expires_at missing"          unless rec[:expires_at].present?

      # Entity ID check — particularly important for LLM output
      if rec[:affected_entity_id].present? && rec[:affected_entity_type].present?
        klass = ENTITY_CLASSES[rec[:affected_entity_type]]
        if klass.nil?
          errors << "unknown entity type '#{rec[:affected_entity_type]}'"
        elsif !klass.exists?(rec[:affected_entity_id])
          errors << "#{rec[:affected_entity_type]} #{rec[:affected_entity_id]} does not exist"
        end
      end

      # Evidence item structure check (accept both string and symbol keys)
      Array(rec[:evidence]).each_with_index do |item, i|
        next unless item.is_a?(Hash)
        h = item.with_indifferent_access
        errors << "evidence[#{i}] must have type and id" unless h[:type].present? && h[:id].present?
      end

      errors
    end
  end
end
