# Structured request logging via lograge.
# Emits one JSON line per request instead of Rails' multi-line default.
# Fields: method, path, status, duration, db_runtime, view_runtime,
#         user_id, ip, request_id, plus any custom_payload fields.
#
# Example output:
# {"method":"GET","path":"/api/tasks","status":200,"duration":12.4,
#  "db":8.1,"view":0.0,"user_id":"abc-123","ip":"10.0.0.1","request_id":"xyz"}
Rails.application.configure do
  config.lograge.enabled      = true
  config.lograge.formatter    = Lograge::Formatters::Json.new
  config.lograge.base_controller_class = ["ActionController::API", "ActionController::Base"]

  # Include request_id for correlating logs across distributed traces
  config.lograge.custom_options = lambda do |event|
    {
      request_id: event.payload[:headers]&.dig("X-Request-Id") ||
                  event.payload[:request_id],
      ip:         event.payload[:remote_ip],
      user_id:    event.payload[:user_id],
      # Feed and correlation engine log tags
      params:     event.payload[:params]&.except("controller", "action", "format")
                                        &.to_s&.truncate(200)
    }.compact
  end

  # Strip boring Rails default log lines — only structured lines remain
  config.lograge.ignore_actions = ["RailsHealthCheck#show"]
end
