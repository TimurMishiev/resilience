module Signals
  module PayloadSerializer
    module_function

    def call(signal)
      signal.as_json(only: %i[
        id source signal_type external_id
        lat lng altitude speed heading magnitude
        occurred_at ingested_at
      ]).merge(
        raw_payload: signal.raw_payload
      )
    end
  end
end
