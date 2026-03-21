class ApplicationController < ActionController::API
  before_action :set_security_headers

  private

  def set_security_headers
    # API responses only return JSON — no scripts, images, or iframes needed.
    response.set_header("Content-Security-Policy", "default-src 'none'")
    # HSTS is handled at the Fly.io proxy layer (not here) to avoid
    # double-redirect issues when force_ssl is off.
  end
end
