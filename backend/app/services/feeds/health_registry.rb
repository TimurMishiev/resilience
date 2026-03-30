module Feeds
  class HealthRegistry
    class << self
      def record(snapshot)
        OperationalStatus.record!(
          category: "feed_health",
          key: snapshot.fetch(:feed).to_s,
          payload: snapshot.deep_dup
        )
      end

      def all
        OperationalStatus.for_category("feed_health").map { |status| status.payload.deep_symbolize_keys }
      end

      def reset!
        OperationalStatus.where(category: "feed_health").delete_all
      end
    end
  end
end
