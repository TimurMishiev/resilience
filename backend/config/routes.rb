Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  namespace :api do
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

    namespace :ai do
      get  :filter
      post :summary
    end
  end
end
