module Api
  class OperationalHealthController < BaseController
    before_action :require_commander!

    def index
      return if performed?

      render json: {
        data: OperationalStatus.ordered.map do |status|
          {
            category: status.category,
            key: status.key,
            payload: status.payload,
            updated_at: status.updated_at.iso8601(3),
          }
        end,
      }
    end
  end
end
