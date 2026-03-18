class StaticController < ApplicationController
  # Serve the pre-built React SPA for any non-API HTML route.
  # In development the frontend runs on its own Vite server; this action only
  # fires in production (or whenever public/index.html is present).
  def index
    send_file Rails.root.join("public/index.html"),
              type:        "text/html",
              disposition: "inline"
  end
end
