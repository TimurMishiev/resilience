# frozen_string_literal: true

module Exports
  # Generates CSV or JSON exports for a given entity type within a time range.
  # Delegates scoping to the caller (controller applies policy_scope).
  #
  # Usage:
  #   result = Exports::BatchService.call(
  #     scope: policy_scope(ExternalSignal),
  #     entity_type: "signals",
  #     format: "csv",
  #     from: 1.week.ago,
  #     to: Time.current,
  #   )
  #   result.payload[:data]     # => String (CSV or JSON)
  #   result.payload[:filename] # => "signals-20260404-1200.csv"
  class BatchService < ApplicationService
    MAX_ROWS = 10_000

    ENTITY_CONFIGS = {
      "signals" => {
        order: :occurred_at,
        columns: %w[id source signal_type lat lng magnitude occurred_at external_id],
        headers: %w[ID Source Type Latitude Longitude Magnitude OccurredAt ExternalID],
        time_column: :occurred_at,
      },
      "incidents" => {
        order: :opened_at,
        columns: %w[id title status severity confidence site_id area_of_operation_id assigned_to_id opened_at closed_at],
        headers: %w[ID Title Status Severity Confidence SiteID AreaOfOperationID AssignedToID OpenedAt ClosedAt],
        time_column: :opened_at,
      },
      "tasks" => {
        order: :created_at,
        columns: %w[id title description priority workflow_status site_id asset_id created_at updated_at],
        headers: %w[ID Title Description Priority WorkflowStatus SiteID AssetID CreatedAt UpdatedAt],
        time_column: :created_at,
      },
      "audit_events" => {
        order: :occurred_at,
        columns: %w[id actor entity_type entity_id event_type action correlation_id occurred_at],
        headers: %w[ID Actor EntityType EntityID EventType Action CorrelationID OccurredAt],
        time_column: :occurred_at,
      },
      "sites" => {
        order: :name,
        columns: %w[id name latitude longitude status geofence_radius_km organization_id area_of_operation_id created_at updated_at],
        headers: %w[ID Name Latitude Longitude Status GeofenceRadiusKm OrganizationID AreaOfOperationID CreatedAt UpdatedAt],
        time_column: :created_at,
      },
    }.freeze

    def initialize(scope:, entity_type:, format:, from: nil, to: nil)
      @scope = scope
      @entity_type = entity_type
      @format = format
      @from = from
      @to = to
    end

    def call
      config = ENTITY_CONFIGS[@entity_type]
      return ServiceResult.failure(errors: ["Unsupported entity type: #{@entity_type}"]) unless config

      unless %w[csv json].include?(@format)
        return ServiceResult.failure(errors: ["Unsupported format: #{@format}. Use csv or json."])
      end

      records = build_query(config).to_a
      data = @format == "csv" ? to_csv(records, config) : to_json(records, config)
      timestamp = Time.current.strftime("%Y%m%d-%H%M")
      filename = "#{@entity_type}-#{timestamp}.#{@format}"

      ServiceResult.success(data: data, filename: filename, count: records.size)
    end

    private

    def build_query(config)
      relation = @scope.order(config[:order] => :desc)
      col = config[:time_column]

      if @from.present?
        relation = relation.where(col => @from..)
      end

      if @to.present?
        relation = relation.where(col => ..@to)
      end

      relation.limit(MAX_ROWS)
    end

    def to_csv(records, config)
      require "csv"
      CSV.generate do |csv|
        csv << config[:headers]
        records.each do |record|
          csv << config[:columns].map { |col| record.public_send(col) }
        end
      end
    end

    def to_json(records, config)
      rows = records.map do |record|
        config[:columns].each_with_object({}) do |col, hash|
          hash[col] = record.public_send(col)
        end
      end
      { entity_type: @entity_type, count: rows.size, exported_at: Time.current.iso8601, records: rows }.to_json
    end
  end
end
