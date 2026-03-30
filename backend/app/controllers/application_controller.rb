class ApplicationController < ActionController::API
  before_action :set_security_headers

  private

  def set_security_headers
    # API responses only return JSON — no scripts, images, or iframes needed.
    response.set_header("Content-Security-Policy", "default-src 'none'")
    # HSTS is handled at the Fly.io proxy layer (not here) to avoid
    # double-redirect issues when force_ssl is off.
  end

  def start_sse_heartbeat(stream_name:, interval_seconds: 25, &block)
    Thread.new do
      loop do
        sleep interval_seconds
        break unless block.call
      rescue IOError, ActionController::Live::ClientDisconnected
        break
      rescue StandardError => e
        Rails.logger.error("[SSE][#{stream_name}] heartbeat failed: #{e.class}: #{e.message}")
        Observability.capture_exception(
          e,
          tags: { component: "sse_heartbeat", stream: stream_name },
          extra: { interval_seconds: interval_seconds },
          throttle_key: "sse_heartbeat:#{stream_name}:#{e.class}",
          throttle_seconds: 300
        )
        break
      end
    end
  end
end
