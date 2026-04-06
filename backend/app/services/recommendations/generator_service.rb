module Recommendations
  # Orchestrates the two-tier recommendation pipeline:
  #   Tier 1 (RuleEngine)  — fast, deterministic, always runs
  #   Tier 2 (LlmEnricher) — Anthropic-powered, runs only when API key is present
  #
  # After generation both tiers are merged, deduplicated, validated, and persisted.
  # Returns a ServiceResult with the count of created recommendations.
  class GeneratorService < ApplicationService
    def call
      ctx_result = ContextAssembler.call
      return ctx_result unless ctx_result.success?

      ctx = ctx_result.context

      tier1_result = RuleEngine.call(context: ctx)
      tier2_result = LlmEnricher.call(context: ctx)

      all_recs = Array(tier1_result.recommendations) + Array(tier2_result.recommendations)

      val_result = Validator.call(recommendations: all_recs)
      valid_recs = val_result.valid

      created = persist(valid_recs)
      expire_stale!

      Rails.logger.info "[GeneratorService] created=#{created} invalid=#{val_result.invalid.size} total_candidates=#{all_recs.size}"
      ServiceResult.success(created: created, invalid_count: val_result.invalid.size)
    rescue ActiveRecord::ActiveRecordError, ActiveRecord::RecordNotUnique => e
      Rails.logger.error "[GeneratorService] #{e.message}\n#{e.backtrace.first(5).join("\n")}"
      ServiceResult.failure(errors: [e.message])
    end

    private

    def persist(recs)
      count = 0
      recs.each do |attrs|
        # Skip if a duplicate is already pending (RuleEngine checks too, but LLM path
        # bypasses that check so we double-guard here)
        next if Recommendation.duplicate_pending?(
          type:        attrs[:recommendation_type],
          entity_type: attrs[:affected_entity_type],
          entity_id:   attrs[:affected_entity_id],
        )

        Recommendation.create!(attrs)
        count += 1
      rescue ActiveRecord::RecordNotUnique
        # Concurrent generation run won the race — harmless, just skip
        Rails.logger.debug "[GeneratorService] dedup race absorbed for #{attrs[:recommendation_type]}/#{attrs[:affected_entity_id]}"
      rescue ActiveRecord::RecordInvalid => e
        Rails.logger.warn "[GeneratorService] skipping invalid rec: #{e.message}"
      end
      count
    end

    def expire_stale!
      expired = Recommendation.expired.update_all(status: "expired")
      Rails.logger.debug "[GeneratorService] expired #{expired} stale recommendations" if expired > 0
    end
  end
end
