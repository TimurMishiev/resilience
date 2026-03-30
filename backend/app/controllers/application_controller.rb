class ApplicationController < ActionController::API
  before_action :set_security_headers

  private

  def admit_sse_stream!(stream_name:)
    result = Sse::StreamAdmission.acquire(
      stream_name: stream_name,
      user: current_user,
      remote_ip: request.remote_ip,
    )

    return result.payload.fetch(:lease) if result.success

    render json: { errors: result.errors }, status: :too_many_requests
    nil
  end

  def refresh_sse_stream_lease(lease, stream_name:)
    return true unless lease

    lease.refresh_if_needed!
    true
  rescue StandardError => e
    Rails.logger.error("[SSE][#{stream_name}] lease refresh failed: #{e.class}: #{e.message}")
    Observability.capture_exception(
      e,
      tags: { component: "sse_stream_lease_refresh", stream: stream_name },
      extra: { user_id: lease.record.user_id, remote_ip: lease.record.remote_ip },
      throttle_key: "sse_stream_lease_refresh:#{stream_name}:#{e.class}",
      throttle_seconds: 300,
    )
    true
  end

  def release_sse_stream_lease(lease, stream_name:)
    return unless lease

    lease.release!
  rescue StandardError => e
    Rails.logger.error("[SSE][#{stream_name}] lease release failed: #{e.class}: #{e.message}")
    Observability.capture_exception(
      e,
      tags: { component: "sse_stream_lease_release", stream: stream_name },
      extra: { user_id: lease.record.user_id, remote_ip: lease.record.remote_ip },
      throttle_key: "sse_stream_lease_release:#{stream_name}:#{e.class}",
      throttle_seconds: 300,
    )
  end

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
