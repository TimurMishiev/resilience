Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins ENV.fetch("CORS_ORIGINS", "http://localhost:5173").split(",")

    resource "*",
      headers: %w[Authorization Content-Type X-Request-Id],
      methods: [ :get, :post, :put, :patch, :delete, :options, :head ],
      expose: [ "X-Request-Id" ]
  end
end
