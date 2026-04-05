# frozen_string_literal: true

# Subscribe to Rails request lifecycle events to collect per-endpoint latency
# metrics. Metrics::Recorder accumulates samples in-memory and
# Metrics::SnapshotJob flushes them to OperationalStatus every 60 seconds.
ActiveSupport::Notifications.subscribe("process_action.action_controller") do |*args|
  event = ActiveSupport::Notifications::Event.new(*args)

  controller = event.payload[:controller]
  action     = event.payload[:action]
  duration   = event.duration # ms

  # Skip non-API controllers and SSE streaming endpoints (duration is meaningless)
  next unless controller&.start_with?("Api::")
  next if event.payload[:response]&.content_type&.include?("text/event-stream")

  Metrics::Recorder.record_request(
    controller: controller,
    action: action,
    duration_ms: duration.round(1)
  )
end
