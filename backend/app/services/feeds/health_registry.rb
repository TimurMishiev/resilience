module Feeds
  class HealthRegistry
    # FIXME: process-local — on multi-machine deployments each machine holds its
    # own snapshot state. `/api/feed_health` returns stale data if the request
    # is routed to a machine that hasn't run a poll cycle. Migrate to a DB-backed
    # or Redis-backed store if HA feed health visibility is required.
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
