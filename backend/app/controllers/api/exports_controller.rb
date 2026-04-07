module Api
  class ExportsController < BaseController
    include AuditEventScoping

    ENTITY_SCOPES = {
      "signals" => ExternalSignal,
      "incidents" => Incident,
      "tasks" => Task,
      "audit_events" => AuditEvent,
      "sites" => Site,
      "signal_rule_matches" => SignalRuleMatch,
    }.freeze

    FILTER_KEYS = %i[source signal_type status severity workflow_status site_id rule_id priority].freeze

    # POST /api/exports
    # Body: { entity_type, format, from?, to?, source?, signal_type?, status?, severity?, workflow_status?, site_id?, rule_id?, priority? }
    def create
      entity_type = params.require(:entity_type)
      format = params.require(:format)

      model = ENTITY_SCOPES[entity_type]
      unless model
        authorize :export, :create?
        render json: { errors: ["Unknown entity type: #{entity_type}"] }, status: :bad_request
        return
      end

      scope = if entity_type == "audit_events"
                scope_audit_events_by_org(model.all)
              else
                policy_scope(model)
              end
      authorize :export, :create?

      filters = params.permit(*FILTER_KEYS).to_h.select { |_, v| v.present? }

      result = Exports::BatchService.call(
        scope: scope,
        entity_type: entity_type,
        format: format,
        from: safe_parse_datetime(params[:from]),
        to: safe_parse_datetime(params[:to]),
        filters: filters,
      )

      if result.success?
        Audit::EventWriter.write(
          actor: current_user.email,
          entity_type: "User",
          entity_id: current_user.id,
          event_type: "data_exported",
          action: "export",
          after_snapshot: {
            entity_type: entity_type,
            format: format,
            count: result.count,
            from: params[:from],
            to: params[:to],
            filters: filters.presence,
          }.compact,
          correlation_id: SecureRandom.uuid,
          metadata: { entity_type: entity_type, format: format, count: result.count },
        )

        content_type = format == "csv" ? "text/csv" : "application/json"
        send_data result.data,
                  filename: result.filename,
                  type: content_type,
                  disposition: "attachment"
      else
        render_service_failure(result)
      end
    end
  end
end
