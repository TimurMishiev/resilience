module Assets
  # Changes the status of an Asset and writes the corresponding audit event.
  class StatusChangeService < ApplicationService
    def initialize(asset:, to_status:, actor:)
      @asset = asset
      @to_status = to_status
      @actor = actor
    end

    def call
      unless Asset::STATUSES.include?(@to_status)
        return ServiceResult.failure(errors: ["'#{@to_status}' is not a valid asset status"])
      end

      if @asset.status == @to_status
        return ServiceResult.failure(errors: ["Asset is already in status '#{@to_status}'"])
      end

      before = @asset.attributes.except("updated_at")
      correlation_id = SecureRandom.uuid

      ActiveRecord::Base.transaction do
        @asset.update!(status: @to_status)

        Audit::EventWriter.write(
          actor: @actor,
          entity_type: "Asset",
          entity_id: @asset.id,
          event_type: "asset.status_changed",
          action: "status_change",
          before_snapshot: before,
          after_snapshot: @asset.attributes.except("updated_at"),
          metadata: { from_status: before["status"], to_status: @to_status },
          correlation_id: correlation_id
        )
      end

      ServiceResult.success(asset: @asset)
    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: e.record.errors.full_messages)
    end
  end
end
