Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  # SPA catch-all — return index.html for all non-API, non-asset routes so
  # that React Router handles deep links (/map, /signals, etc.) correctly.
  # Only active when public/index.html exists (i.e. in the production Docker image).
  if File.exist?(Rails.root.join("public/index.html"))
    root to: "static#index"
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
      post   :login,  to: "sessions#create"
      delete :logout, to: "sessions#destroy"
    end

    resources :sites, only: %i[index show] do
      member do
        patch :unflag
        patch :toggle_status
        patch :update_geofence
        get   :timeline
        get   :risk_history
      end
    end
    resources :assets, only: %i[index show update]

    resources :tasks, only: %i[index show create update] do
      member do
        post :transition
        get  :allowed_transitions
      end
    end

    resources :audit_events, only: [:index]
    get "feed_health", to: "feed_health#index"

    get "readiness",   to: "readiness#index"
    get "risk_scores", to: "risk_scores#index"

    namespace :analytics do
      get :throughput
      get :swimlane
    end

    namespace :ai do
      get  :filter
      post :summary
      post :export
    end

    get  "events",    to: "events#stream"
    post "sse_token", to: "sse_tokens#create"

    get "telemetry", to: "telemetry#index"
    namespace :telemetry do
      get :stream
    end

    resources :signals, only: %i[index show create] do
      collection do
        get :stream
      end
    end
    resources :correlation_rules, only: %i[index show create update destroy] do
      collection do
        get :effectiveness
      end
      member do
        post :dry_run
      end
    end
    resources :signal_rule_matches, only: %i[index show] do
      collection do
        post :bulk_transition
        get  :active_breach_sites
      end
      member do
        post :transition
        get  :allowed_transitions
      end
    end
    resources :incidents, only: %i[index show update] do
      member do
        post  :transition
        get   :allowed_transitions
        patch :assign
        get   'notes', action: :list_notes
        post  'notes', action: :add_note
        get   :chain
        post  :prosecute,                        action: :initiate_prosecution
        get   'prosecution_steps',               action: :list_prosecution_steps
        post  'prosecution_steps',               action: :add_prosecution_step
      end
    end

    resources :recommendations, only: %i[index] do
      collection do
        post :generate
        get  :metrics
      end
      member do
        post :accept
        post :reject
        post :defer
        post :execute
      end
    end

    resources :areas_of_operation, only: %i[index show create update destroy] do
      member do
        patch :posture, action: :update_posture
      end
    end

    resources :chokepoints, only: %i[index show create update destroy]
    resources :commander_intents, only: %i[create update]
    resources :pace_plans, only: %i[create update]
    resources :salute_reports, only: %i[create]

    resources :vessels, only: %i[index show] do
      member do
        get :tracks
      end
    end

    get "planning", to: "planning#index"
  end
end
