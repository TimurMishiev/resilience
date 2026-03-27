module Feeds
  class HealthRegistry
    @snapshots = {}
    @mutex = Mutex.new

    class << self
      def record(snapshot)
        @mutex.synchronize do
          @snapshots[snapshot.fetch(:feed).to_s] = snapshot.dup
        end
      end

      def all
        @mutex.synchronize do
          @snapshots.values.map(&:dup).sort_by { |snapshot| snapshot[:feed].to_s }
        end
      end

      def reset!
        @mutex.synchronize do
          @snapshots = {}
        end
      end
    end
  end
end
