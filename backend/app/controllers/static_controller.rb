class StaticController < ApplicationController
  # Serve the pre-built React SPA for any non-API HTML route.
  # In development the frontend runs on its own Vite server; this action only
  # fires in production (or whenever public/index.html is present).
  #
  # Skip the API-only CSP (default-src 'none') that ApplicationController sets —
  # it would block every <script>, <link>, and fetch() call in the SPA.
  # Apply HTML-page security headers instead.
  skip_before_action :set_security_headers

  before_action :set_spa_security_headers

  def index
    send_file Rails.root.join("public/index.html"),
              type:        "text/html",
              disposition: "inline"
  end

  private

  def set_spa_security_headers
    response.set_header("X-Frame-Options",        "DENY")
    response.set_header("X-Content-Type-Options",  "nosniff")
    if Rails.configuration.assume_ssl
      response.set_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    end
    response.set_header("Content-Security-Policy",
      "default-src 'self'; " \
      "script-src 'self' blob: 'wasm-unsafe-eval' 'unsafe-eval'; " \
      "style-src 'self' 'unsafe-inline'; " \
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://ion.cesium.com; " \
      "connect-src 'self' https://ion.cesium.com https://assets.ion.cesium.com https://api.cesium.com wss:; " \
      "worker-src 'self' blob:; " \
      "child-src 'self' blob:; " \
      "font-src 'self'; " \
      "object-src 'none'; " \
      "base-uri 'self'; " \
      "frame-ancestors 'none'")
  end
end
