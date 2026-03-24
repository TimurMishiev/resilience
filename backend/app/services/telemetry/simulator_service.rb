module Telemetry
  # Background thread that simulates live asset telemetry.
  # Ticks every TICK_INTERVAL seconds, updating each asset's position,
  # battery level, speed, and heading. Publishes each snapshot to
  # Telemetry::Broadcaster so connected SSE clients receive it.
  #
  # Started once via config/initializers/telemetry_simulator.rb.
  # Safe to call start! multiple times — idempotent via @thread guard.
  class SimulatorService
    TICK_INTERVAL     = 3      # seconds between full broadcast cycles
    BATTERY_DRAIN     = 0.02   # % per tick for moving assets
    BATTERY_IDLE_DRAIN = 0.005 # % per tick for stationary assets
    MAX_SPEED_MS      = 15.0   # m/s (~54 km/h) maximum simulated speed
    POSITION_SCALE    = 0.0001 # degrees per m/s — controls how fast markers move

    def self.start!
      @thread ||= new.tap(&:run)
    end

    def run
      @thread = Thread.new do
        Thread.current.name = "telemetry-simulator"
        Thread.current.abort_on_exception = false

        # Build initial state from DB — lat/lng seeded from home site
        @state = build_initial_state

        loop do
          sleep TICK_INTERVAL
          tick
        rescue ActiveRecord::StatementInvalid, PG::Error => e
          Rails.logger.warn "[Telemetry::Simulator] DB error: #{e.message} — retrying in 10s"
          sleep 10
          @state = build_initial_state
          retry
        rescue StandardError => e
          Rails.logger.error "[Telemetry::Simulator] #{e.class}: #{e.message}"
          sleep TICK_INTERVAL
          retry
        end
      end
    end

    private

    AssetState = Struct.new(
      :id, :name, :asset_type,
      :lat, :lng,
      :heading,      # degrees 0-359
      :speed,        # m/s
      :battery,      # 0.0 – 100.0
      keyword_init: true
    )

    def build_initial_state
      Asset.includes(:home_site).map do |asset|
        site = asset.home_site
        lat  = site&.latitude&.to_f  || 37.7749   # default: SF
        lng  = site&.longitude&.to_f || -122.4194

        AssetState.new(
          id:         asset.id,
          name:       asset.name,
          asset_type: asset.asset_type,
          lat:        lat + rand(-0.005..0.005),   # small initial scatter
          lng:        lng + rand(-0.005..0.005),
          heading:    rand(360),
          speed:      rand(2.0..8.0),
          battery:    rand(60.0..100.0),
        )
      end
    rescue ActiveRecord::RecordNotFound, ActiveRecord::StatementInvalid
      []
    end

    def tick
      return if @state.nil? || @state.empty?

      occurred_at = Time.current
      rows = []

      @state.each do |s|
        update_asset!(s)
        rows << build_row(s, occurred_at)
      end

      persist!(rows, occurred_at)
      publish(rows) unless Telemetry::Broadcaster.instance.subscriber_count.zero?
    end

    def update_asset!(s)
      # Gradually shift heading
      s.heading = (s.heading + rand(-15..15)) % 360

      # Vary speed smoothly
      s.speed = clamp(s.speed + rand(-1.5..1.5), 0.5, MAX_SPEED_MS)

      # Move position in direction of heading
      rad        = s.heading * Math::PI / 180.0
      s.lat     += Math.cos(rad) * s.speed * POSITION_SCALE
      s.lng     += Math.sin(rad) * s.speed * POSITION_SCALE

      # Drain battery
      drain   = s.speed > 1.0 ? BATTERY_DRAIN : BATTERY_IDLE_DRAIN
      s.battery = clamp(s.battery - drain, 0.0, 100.0)

      # Bounce battery back slowly when "docked" (battery very low)
      s.battery = clamp(s.battery + 0.5, 0.0, 100.0) if s.battery < 10.0
    end

    def build_row(s, occurred_at)
      {
        asset_id:    s.id,
        name:        s.name,
        lat:         s.lat.round(6),
        lng:         s.lng.round(6),
        heading:     s.heading,
        speed:       s.speed.round(1),
        battery:     s.battery.round(1),
        occurred_at: occurred_at,
      }
    end

    def persist!(rows, occurred_at)
      TelemetryReading.insert_all!(
        rows.map do |row|
          {
            asset_id:    row[:asset_id],
            lat:         row[:lat],
            lng:         row[:lng],
            heading:     row[:heading],
            speed:       row[:speed],
            battery:     row[:battery],
            occurred_at: row[:occurred_at],
            created_at:  occurred_at,
          }
        end
      )

      Asset.where(id: rows.map { |row| row[:asset_id] }).update_all(last_reported_at: occurred_at)
    end

    def publish(rows)
      rows.each do |row|
        Telemetry::Broadcaster.instance.publish(
          asset_id: row[:asset_id],
          name:     row[:name],
          lat:      row[:lat],
          lng:      row[:lng],
          heading:  row[:heading],
          speed:    row[:speed],
          battery:  row[:battery],
          ts:       row[:occurred_at].to_i,
        )
      end
    end

    def clamp(val, min, max)
      [[val, min].max, max].min
    end
  end
end
