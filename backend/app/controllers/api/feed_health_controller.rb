module Api
  class FeedHealthController < BaseController
    skip_after_action :verify_authorized
    before_action :require_commander!

    def index
      render json: { data: Feeds::HealthRegistry.all }
    end
  end
end
