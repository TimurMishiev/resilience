require "json"

module Recommendations
  # Tier 2: Uses the Anthropic API to generate narrative recommendations based
  # on the assembled operational context. Outputs are validated strictly before
  # being accepted — hallucinated entity IDs are rejected at the Validator layer.
  #
  # The LLM is NOT given raw database tables — only a curated summary snapshot.
  # This keeps the prompt tight, reduces hallucination surface, and ensures the
  # model reasons about the same data the operator sees.
  class LlmEnricher < ApplicationService
    MODEL             = "claude-3-5-haiku-20241022"
    MAX_TOKENS        = 1024
    TEMPERATURE       = 0.2   # low temp → more deterministic operational output
    VALID_REC_TYPES   = Recommendation::VALID_TYPES

    def initialize(context:)
      @ctx = context
    end

    def call
      return ServiceResult.success(recommendations: []) unless api_key_present?

      raw = call_anthropic(build_prompt)
      parsed = parse_response(raw)
      ServiceResult.success(recommendations: parsed)
    rescue => e
      Rails.logger.error "[LlmEnricher] #{e.message}"
      ServiceResult.success(recommendations: [])  # degrade gracefully — Tier 1 still runs
    end

    private

    def api_key_present?
      ENV["ANTHROPIC_API_KEY"].present?
    end

    def build_prompt
      ctx_summary = JSON.pretty_generate({
        stale_alerts:       @ctx[:stale_alerts].first(5),
        high_conf_alerts:   @ctx[:high_conf_alerts].first(5),
        open_incidents:     @ctx[:open_incidents].first(5),
        overdue_tasks:      @ctx[:overdue_tasks].first(5),
        flaggable_sites:    @ctx[:flaggable_sites].first(5),
        bulk_triage_sites:  @ctx[:bulk_triage_sites].first(5),
        asset_availability: @ctx.fetch(:asset_availability, {}),
        roe_posture:        active_postures,
      })

      <<~PROMPT
        You are an operational intelligence assistant for a mission operations console.
        Analyse the following operational snapshot and generate 1–3 high-value recommendations
        that an operator should act on NOW, beyond the obvious rule-based ones.

        Focus on:
        - Cross-cutting patterns (e.g. same site appearing in multiple alert + incident + task queues)
        - Escalation urgency based on time elapsed + confidence trend
        - Tasks that should be created to address open incidents with no associated tasks
        - Incidents that could be contained or resolved based on the evidence pattern

        IMPORTANT CONSTRAINTS — factor these into every recommendation:
        - ROE posture: the `roe_posture` field lists each Area of Operation and its current
          engagement posture (observe/defensive/weapons_free). Do NOT recommend kinetic or
          active-response actions for sites whose AO is in Observe posture.
        - Asset availability: the `asset_availability` field shows how many assets are
          currently available/assigned/degraded/offline. Do NOT recommend creating tasks
          if available + assigned = 0, as the task cannot be staffed.

        Respond ONLY with valid JSON (no markdown, no preamble) matching this schema exactly:
        [
          {
            "recommendation_type": "<one of: #{VALID_REC_TYPES.join(' | ')}>",
            "confidence": <float 0.0–1.0>,
            "rationale": "<2–3 sentence explainable rationale referencing specific entities by name and current ROE posture>",
            "evidence": [{"type": "<site|incident|alert|task>", "id": "<uuid>", "detail": "<short note>"}],
            "action_payload": { ... },
            "affected_entity_type": "<Site|Incident|SignalRuleMatch|Task>",
            "affected_entity_id": "<uuid of the primary affected entity>"
          }
        ]

        Only use entity IDs that appear in the snapshot below. Do not invent IDs.
        If no meaningful recommendations beyond rule-based exist, return an empty array [].

        OPERATIONAL SNAPSHOT:
        #{ctx_summary}
      PROMPT
    end

    # Deduplicates posture_by_site_id to one entry per AO for a concise LLM summary.
    def active_postures
      @ctx.fetch(:posture_by_site_id, {})
        .values
        .uniq { |v| v[:ao_id] }
        .map  { |v| { ao: v[:ao_name], posture: v[:posture] } }
        .first(10)
    end

    def call_anthropic(prompt)
      client = Anthropic::Client.new(api_key: ENV.fetch("ANTHROPIC_API_KEY"))
      response = client.messages.create(
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        messages:   [{ role: "user", content: prompt }],
      )
      response.content.first.text
    end

    def parse_response(raw)
      # Strip markdown fences if the model ignores the "no markdown" instruction
      cleaned = raw.gsub(/\A```(?:json)?\s*/i, "").gsub(/\s*```\z/, "").strip
      data = JSON.parse(cleaned)
      return [] unless data.is_a?(Array)

      data.filter_map do |rec|
        next unless VALID_REC_TYPES.include?(rec["recommendation_type"])

        {
          recommendation_type:  rec["recommendation_type"],
          tier:                 "llm",
          confidence:           rec["confidence"].to_f.clamp(0.0, 1.0),
          rationale:            rec["rationale"].to_s.presence || "LLM recommendation",
          evidence:             Array(rec["evidence"]),
          action_payload:       rec["action_payload"].is_a?(Hash) ? rec["action_payload"] : {},
          affected_entity_type: rec["affected_entity_type"],
          affected_entity_id:   rec["affected_entity_id"],
          expires_at:           Recommendation::EXPIRY_BY_TIER["llm"].from_now,
          status:               "pending",
        }
      end
    rescue JSON::ParserError => e
      Rails.logger.warn "[LlmEnricher] JSON parse failed: #{e.message}"
      []
    end
  end
end
