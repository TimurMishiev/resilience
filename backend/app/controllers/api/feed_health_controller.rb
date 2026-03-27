module Api
  class FeedHealthController < BaseController
    before_action :require_commander!

    def index
      render json: { data: Feeds::HealthRegistry.all }
    end
  end
end
