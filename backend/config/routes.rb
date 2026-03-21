Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  # SPA catch-all — return index.html for all non-API, non-asset routes so
  # that React Router handles deep links (/map, /signals, etc.) correctly.
  # Only active when public/index.html exists (i.e. in the production Docker image).
  if File.exist?(Rails.root.join("public/index.html"))
    get "*path",
        to:          "static#index",
        constraints: ->(req) {
          !req.path.start_with?("/api/", "/up") &&
            !req.path.match?(/\.\w+$/)
        },
        format: false
  end

  namespace :api do
    namespace :auth do
      post :login, to: "sessions#create"
    end

    resources :sites, only: %i[index show] do
      member do
        patch :unflag
        patch :toggle_status
        get   :timeline
      end
    end
    resources :assets, only: %i[index show]

    resources :tasks, only: %i[index show create update] do
      member do
        post :transition
        get  :allowed_transitions
      end
    end

    resources :audit_events, only: [:index]

    get "readiness",   to: "readiness#index"
    get "risk_scores", to: "risk_scores#index"

    namespace :analytics do
      get :throughput
    end

    namespace :ai do
      get  :filter
      post :summary
    end

    get  "events",    to: "events#stream"
    post "sse_token", to: "sse_tokens#create"

    namespace :telemetry do
      get :stream
    end

    resources :signals,               only: %i[index show create]
    resources :correlation_rules, only: %i[index show create update destroy] do
      member do
        post :dry_run
      end
    end
    resources :signal_rule_matches, only: %i[index show] do
      member do
        post :transition
        get  :allowed_transitions
      end
    end
    resources :areas_of_operation,    only: %i[index show create update destroy]

    resources :vessels, only: %i[index show] do
      member do
        get :tracks
      end
    end
  end
end
