module Api
  class ExportsController < BaseController
    before_action :require_commander!

    ENTITY_SCOPES = {
      "signals" => ExternalSignal,
      "incidents" => Incident,
      "tasks" => Task,
      "audit_events" => AuditEvent,
      "sites" => Site,
    }.freeze

    # POST /api/exports
    # Body: { entity_type: "signals", format: "csv", from?: ISO8601, to?: ISO8601 }
    def create
      entity_type = params.require(:entity_type)
      format = params.require(:format)

      model = ENTITY_SCOPES[entity_type]
      unless model
        authorize :export, :create?
        render json: { errors: ["Unknown entity type: #{entity_type}"] }, status: :bad_request
        return
      end

      scope = entity_type == "audit_events" ? model.all : policy_scope(model)
      authorize :export, :create?

      result = Exports::BatchService.call(
        scope: scope,
        entity_type: entity_type,
        format: format,
        from: safe_parse_datetime(params[:from]),
        to: safe_parse_datetime(params[:to]),
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
          },
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
