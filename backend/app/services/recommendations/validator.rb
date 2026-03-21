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

      # Evidence item structure + provenance check (accept both string and symbol keys).
      # For LLM-produced recommendations each item's entity ID is verified against the
      # live database so that hallucinated references are caught before persistence.
      Array(rec[:evidence]).each_with_index do |item, i|
        next unless item.is_a?(Hash)
        h = item.with_indifferent_access
        unless h[:type].present? && h[:id].present?
          errors << "evidence[#{i}] must have type and id"
          next
        end

        # Map evidence type string → AR model class and verify existence
        evidence_class = ENTITY_CLASSES[evidence_entity_class_name(h[:type])]
        if evidence_class && !evidence_class.exists?(h[:id])
          errors << "evidence[#{i}] #{h[:type]} #{h[:id]} does not exist"
        end
      end

      errors
    end

    # Maps evidence item type strings (as the LLM sees them) to AR class names
    EVIDENCE_TYPE_CLASS = {
      "site"     => "Site",
      "incident" => "Incident",
      "alert"    => "SignalRuleMatch",
      "task"     => "Task",
    }.freeze

    def evidence_entity_class_name(type_str)
      EVIDENCE_TYPE_CLASS[type_str.to_s.downcase]
    end
  end
end
