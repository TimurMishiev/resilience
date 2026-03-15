Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  namespace :api do
    namespace :auth do
      post :login, to: "sessions#create"
    end

    resources :sites,  only: %i[index show]
    resources :assets, only: %i[index show]

    resources :tasks, only: %i[index show create update] do
      member do
        post :transition
        get  :allowed_transitions
      end
    end

    resources :audit_events, only: [:index]

    get "readiness", to: "readiness#index"

    namespace :analytics do
      get :throughput
    end

    namespace :ai do
      get  :filter
      post :summary
    end

    get "events", to: "events#stream"

    namespace :telemetry do
      get :stream
    end

    resources :signals,             only: %i[index show]
    resources :correlation_rules,   only: %i[index show create update destroy]
    resources :signal_rule_matches, only: %i[index show]
  end
end
