module Recommendations
  # Validates recommendation attribute hashes before they are persisted.
  # For LLM-produced recommendations this includes entity ID verification
  # against the live database — hallucinated IDs are rejected.
  #
  # Trust boundary: three independent layers are checked for every rec:
  #   1. primary entity   — affected_entity_type / affected_entity_id must exist
  #   2. evidence items   — each item's ID must exist in the matching AR model
  #   3. action_payload   — per-recommendation-type schema + ID existence checks
  #                         so that ExecutorService never acts on a hallucinated
  #                         or mismatched target entity inside the payload
  class Validator < ApplicationService
    ENTITY_CLASSES = {
      "Site"             => Site,
      "Incident"         => Incident,
      "SignalRuleMatch"  => SignalRuleMatch,
      "Task"             => Task,
      "Asset"            => Asset,
    }.freeze

    # Describes which payload keys are required for each type and which AR
    # class the referenced ID must exist in.
    PAYLOAD_REQUIREMENTS = {
      "close_stale_alert"  => [{ key: :alert_id,    klass: SignalRuleMatch }],
      "acknowledge_alert"  => [{ key: :alert_id,    klass: SignalRuleMatch }],
      "escalate_incident"  => [{ key: :incident_id, klass: Incident        }],
      "create_task"        => [{ key: :site_id,     klass: Site            }],
      "flag_site"          => [{ key: :site_id,     klass: Site            }],
      "bulk_triage_alerts" => [{ key: :site_id,     klass: Site            }],
      "assign_asset"       => [{ key: :task_id,     klass: Task            },
                                { key: :asset_id,   klass: Asset           }],
    }.freeze

    # `organization_id:` is optional. When set, every entity-existence check
    # (primary entity, evidence items, action_payload IDs) is tenant-scoped
    # using the same per-class scoping rules ContextAssembler applies. This
    # is a defense-in-depth layer behind ExecutorService's `find_scoped`
    # and RecommendationPolicy::Scope: ContextAssembler only feeds the LLM
    # in-tenant entities, but a hallucinated bigserial id could happen to
    # collide with another tenant's row. Without this scoping, Validator
    # would pass that recommendation through; with it, the rec is rejected
    # before persistence so it never appears in the unrestricted-admin view
    # and never wastes an LLM-tier slot. Pass nil (the default) for
    # global-mode / single-tenant deployments — preserves pre-MT2 behavior.
    def initialize(recommendations:, organization_id: nil)
      @recs            = recommendations
      @organization_id = organization_id
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

    attr_reader :organization_id

    def validate(rec)
      errors = []

      errors << "invalid recommendation_type" unless Recommendation::VALID_TYPES.include?(rec[:recommendation_type])
      errors << "invalid tier"                unless Recommendation::VALID_TIERS.include?(rec[:tier])
      errors << "confidence out of range"     unless (0.0..1.0).cover?(rec[:confidence].to_f)
      errors << "rationale blank"             if rec[:rationale].blank?
      errors << "expires_at missing"          unless rec[:expires_at].present?

      # Entity ID check — particularly important for LLM output. When
      # organization_id is set, the existence check is tenant-scoped so
      # a hallucinated id that happens to belong to a different tenant
      # is rejected here, before persistence.
      if rec[:affected_entity_id].present? && rec[:affected_entity_type].present?
        klass = ENTITY_CLASSES[rec[:affected_entity_type]]
        if klass.nil?
          errors << "unknown entity type '#{rec[:affected_entity_type]}'"
        elsif !tenant_scoped_exists?(rec[:affected_entity_type], rec[:affected_entity_id])
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
        entity_type_name = evidence_entity_class_name(h[:type])
        if entity_type_name && !tenant_scoped_exists?(entity_type_name, h[:id])
          errors << "evidence[#{i}] #{h[:type]} #{h[:id]} does not exist"
        end
      end

      # Action payload validation — ensures the IDs ExecutorService will act on
      # actually exist before the recommendation is persisted.  Without this an
      # LLM can pass primary-entity + evidence checks while carrying a hallucinated
      # alert_id / incident_id / site_id in the executable payload.
      errors.concat(validate_action_payload(rec[:recommendation_type], rec[:action_payload]))

      # Cross-entity consistency — verifies that the payload target matches the
      # surfaced entity.  Prevents an LLM from displaying Incident A while
      # carrying Incident B in the executable payload (both would pass existence
      # checks above, but ExecutorService would act on the wrong entity).
      errors.concat(validate_payload_target_match(
        rec[:recommendation_type],
        rec[:action_payload],
        rec[:affected_entity_type],
        rec[:affected_entity_id]
      ))

      errors
    end

    # Validates the action_payload for a given recommendation type.
    # Returns an array of error strings (empty means valid).
    def validate_action_payload(type, payload)
      requirements = PAYLOAD_REQUIREMENTS[type]
      return [] if requirements.nil?  # unknown type already flagged above

      payload_h = (payload || {}).with_indifferent_access

      id_errors = requirements.flat_map do |req|
        id = payload_h[req[:key]]
        if id.blank?
          ["action_payload missing required key '#{req[:key]}'"]
        elsif !tenant_scoped_exists?(req[:klass].name, id)
          ["action_payload #{req[:key]} #{id} does not exist"]
        else
          []
        end
      end

      # Extra: escalate_incident must carry a valid to_status string so
      # ExecutorService never issues a transition with an arbitrary model value.
      if type == "escalate_incident" && id_errors.empty?
        to_status = payload_h[:to_status].to_s.strip
        if to_status.present? && !Incident::VALID_STATUSES.include?(to_status)
          id_errors << "action_payload to_status '#{to_status}' is not a valid incident status"
        end
      end

      id_errors
    end

    # Verifies that the IDs inside action_payload refer to the same entity as
    # affected_entity_*.  An LLM can produce a recommendation that passes all
    # existence checks while carrying a different entity in the executable
    # payload — this check closes that trust-boundary gap.
    # Which affected_entity_type values are legally surface-able for each
    # recommendation_type. Close_stale_alert / acknowledge_alert can be
    # surfaced either directly against the alert (SignalRuleMatch) or
    # against its parent incident — both are legitimate UIs. Naming the
    # full valid set here lets validate_payload_target_match fail-closed
    # on incoherent combinations (e.g. type=escalate_incident with
    # entity_type=Site) instead of silently skipping check 4 of ADR-005.
    EXPECTED_ENTITY_TYPES = {
      "escalate_incident"   => %w[Incident].freeze,
      "close_stale_alert"   => %w[Incident SignalRuleMatch].freeze,
      "acknowledge_alert"   => %w[Incident SignalRuleMatch].freeze,
      "flag_site"           => %w[Site].freeze,
      "create_task"         => %w[Site].freeze,
      "bulk_triage_alerts"  => %w[Site].freeze,
      "assign_asset"        => %w[Task].freeze,
    }.freeze

    def validate_payload_target_match(type, payload, entity_type, entity_id)
      return [] if entity_id.blank? || entity_type.blank?

      expected_types = EXPECTED_ENTITY_TYPES[type]
      if expected_types && !expected_types.include?(entity_type)
        # Fail-closed: a type/entity mismatch means the downstream payload
        # check cannot be meaningfully evaluated. Rejecting here prevents the
        # "shown as Site, executes as Incident" class of failure that check 4
        # of the trust boundary exists to catch.
        expected_label = expected_types.size == 1 ? expected_types.first : expected_types.join(" or ")
        return ["recommendation_type '#{type}' requires affected_entity_type '#{expected_label}', got '#{entity_type}'"]
      end

      payload_h = (payload || {}).with_indifferent_access
      errors    = []

      case type
      when "escalate_incident"
        if payload_h[:incident_id].present? &&
           payload_h[:incident_id].to_s != entity_id.to_s
          errors << "action_payload incident_id does not match affected_entity_id"
        end
      when "close_stale_alert", "acknowledge_alert"
        if payload_h[:alert_id].present?
          # Two legal surfacings: directly against the alert, or against its
          # parent incident. Each requires a different coherence check.
          if entity_type == "Incident"
            unless SignalRuleMatch.where(id: payload_h[:alert_id], incident_id: entity_id).exists?
              errors << "action_payload alert_id does not belong to the surfaced incident"
            end
          elsif entity_type == "SignalRuleMatch" && payload_h[:alert_id].to_s != entity_id.to_s
            errors << "action_payload alert_id does not match affected_entity_id"
          end
        end
      when "flag_site", "create_task", "bulk_triage_alerts"
        if payload_h[:site_id].present? &&
           payload_h[:site_id].to_s != entity_id.to_s
          errors << "action_payload site_id does not match affected_entity_id"
        end
      when "assign_asset"
        if payload_h[:task_id].present? &&
           payload_h[:task_id].to_s != entity_id.to_s
          errors << "action_payload task_id does not match affected_entity_id"
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
      "asset"    => "Asset",
    }.freeze

    def evidence_entity_class_name(type_str)
      EVIDENCE_TYPE_CLASS[type_str.to_s.downcase]
    end

    # Tenant-scoped existence check. When @organization_id is nil (global
    # / single-tenant mode) this collapses to `klass.exists?(id)` —
    # behavior unchanged. When set, mirrors ContextAssembler's per-class
    # scoping rules so the existence check matches the data the LLM was
    # given. Unknown type_name short-circuits to false (a stricter default
    # than the prior `evidence_class.exists?` short-circuit which silently
    # accepted unknown types).
    def tenant_scoped_exists?(type_name, id)
      klass = ENTITY_CLASSES[type_name]
      return false if klass.nil?
      return klass.exists?(id) if organization_id.nil?

      case type_name
      when "Site"
        Site.where(id: id, organization_id: organization_id).exists?
      when "SignalRuleMatch", "Task"
        klass.joins(:site).where(id: id, sites: { organization_id: organization_id }).exists?
      when "Incident"
        Incident.left_joins(:site, :area_of_operation)
          .where(id: id)
          .where(
            "sites.organization_id = :org_id OR " \
            "(incidents.site_id IS NULL AND areas_of_operation.organization_id = :org_id)",
            org_id: organization_id,
          )
          .exists?
      when "Asset"
        Asset.joins(:home_site).where(id: id, sites: { organization_id: organization_id }).exists?
      else
        false
      end
    end
  end
end
