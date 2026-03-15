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

      if signal.save
        ServiceResult.success(signal: signal, created: true)
      else
        ServiceResult.failure(errors: signal.errors.full_messages)
      end
    end
  end
end
