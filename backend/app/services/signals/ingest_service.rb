module Signals
  # Normalises a raw external payload into a persisted Signal record.
  # Idempotent: calling twice with the same (source, external_id, occurred_at)
  # returns success without creating a duplicate.
  class IngestService < ApplicationService
    def initialize(source:, signal_type:, external_id:, lat:, lng:,
                   occurred_at:, raw_payload:, altitude: nil, speed: nil,
                   heading: nil, magnitude: nil)
      @attrs = {
        source:      source,
        signal_type: signal_type,
        external_id: external_id,
        lat:         lat,
        lng:         lng,
        occurred_at: occurred_at,
        raw_payload: raw_payload,
        altitude:    altitude,
        speed:       speed,
        heading:     heading,
        magnitude:   magnitude
      }
    end

    def call
      signal = ExternalSignal.find_or_initialize_by(
        source:      @attrs[:source],
        external_id: @attrs[:external_id],
        occurred_at: @attrs[:occurred_at]
      )

      unless signal.new_record?
        return ServiceResult.success(signal: signal, created: false)
      end

      signal.assign_attributes(@attrs)
      signal.save!

      begin
        Signals::Broadcaster.instance.publish(Signals::PayloadSerializer.call(signal))
      rescue StandardError => e
        Rails.logger.error "[Signals::IngestService] SSE broadcast failed (non-fatal): #{e.class}: #{e.message}"
      end

      ServiceResult.success(signal: signal, created: true)

    rescue ActiveRecord::RecordNotUnique
      # Two feed threads raced on the same signal — the unique index caught it.
      # Re-find the winner's record and return it as a non-created success.
      signal = ExternalSignal.find_by!(
        source:      @attrs[:source],
        external_id: @attrs[:external_id],
        occurred_at: @attrs[:occurred_at]
      )
      ServiceResult.success(signal: signal, created: false)

    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: e.record.errors.full_messages)
    end
  end
end
