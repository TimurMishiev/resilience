module Sse
  class StreamAdmission
    DEFAULT_MAX_STREAMS_PER_USER = 8
    DEFAULT_MAX_STREAMS_PER_IP = 24
    DEFAULT_LEASE_TTL_SECONDS = 180
    LEASE_REFRESH_MARGIN = 60.seconds
    ADVISORY_LOCK_KEY = 8_321_004_221_991

    class LeaseHandle
      attr_reader :record

      def initialize(record)
        @record = record
      end

      def refresh_if_needed!
        return if record.expires_at > StreamAdmission.refresh_deadline

        now = Time.current
        new_expiry = StreamAdmission.lease_expires_at(now)

        SseStreamLease
          .where(id: record.id, lease_key: record.lease_key)
          .update_all(expires_at: new_expiry, updated_at: now)

        record.expires_at = new_expiry
        record.updated_at = now
      end

      def release!
        SseStreamLease.where(id: record.id, lease_key: record.lease_key).delete_all
      end
    end

    class << self
      def acquire(stream_name:, user:, remote_ip:)
        new(stream_name:, user:, remote_ip:).acquire
      end

      def max_streams_per_user
        positive_integer_env("SSE_MAX_STREAMS_PER_USER", DEFAULT_MAX_STREAMS_PER_USER)
      end

      def max_streams_per_ip
        positive_integer_env("SSE_MAX_STREAMS_PER_IP", DEFAULT_MAX_STREAMS_PER_IP)
      end

      def lease_ttl
        positive_integer_env("SSE_STREAM_LEASE_TTL_SECONDS", DEFAULT_LEASE_TTL_SECONDS).seconds
      end

      def lease_expires_at(now = Time.current)
        now + lease_ttl
      end

      def refresh_deadline(now = Time.current)
        now + LEASE_REFRESH_MARGIN
      end

      def obtain_advisory_lock!
        ActiveRecord::Base.connection.execute("SELECT pg_advisory_xact_lock(#{ADVISORY_LOCK_KEY})")
      end

      private

      def positive_integer_env(key, default)
        value = ENV.fetch(key, default).to_i
        value.positive? ? value : default
      end
    end

    def initialize(stream_name:, user:, remote_ip:)
      @stream_name = stream_name
      @user = user
      @remote_ip = remote_ip.to_s
    end

    def acquire
      return ServiceResult.failure(errors: ["Unknown SSE stream: #{@stream_name}"]) unless valid_stream_name?

      now = Time.current
      active_scope = SseStreamLease.active_at(now)
      lease_record = nil
      denial_error = nil
      denial_context = {}

      ActiveRecord::Base.transaction do
        self.class.obtain_advisory_lock!
        SseStreamLease.expired_at(now).delete_all

        user_streams = active_scope.where(user_id: @user.id).count
        ip_streams = active_scope.where(remote_ip: @remote_ip).count

        if user_streams >= self.class.max_streams_per_user
          denial_error = "Too many live streams are already open for this user. Close another live tab and retry."
          denial_context = {
            user_streams: user_streams,
            user_limit: self.class.max_streams_per_user,
            ip_streams: ip_streams,
            ip_limit: self.class.max_streams_per_ip,
          }
          raise ActiveRecord::Rollback
        end

        if ip_streams >= self.class.max_streams_per_ip
          denial_error = "Too many live streams are already open from this network. Retry shortly."
          denial_context = {
            user_streams: user_streams,
            user_limit: self.class.max_streams_per_user,
            ip_streams: ip_streams,
            ip_limit: self.class.max_streams_per_ip,
          }
          raise ActiveRecord::Rollback
        end

        lease_record = SseStreamLease.create!(
          stream_name: @stream_name,
          remote_ip: @remote_ip,
          user_id: @user.id,
          lease_key: SecureRandom.uuid,
          expires_at: self.class.lease_expires_at(now),
        )
      end

      if denial_error
        report_denial!(denial_error, denial_context)
        return ServiceResult.failure(errors: [denial_error])
      end

      ServiceResult.success(lease: LeaseHandle.new(lease_record))
    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: e.record.errors.full_messages)
    rescue StandardError => e
      Rails.logger.error("[SSE] stream admission failed stream=#{@stream_name} user_id=#{@user.id} remote_ip=#{@remote_ip} error=#{e.class}: #{e.message}")
      Observability.capture_exception(
        e,
        tags: { component: "sse_stream_admission", stream: @stream_name },
        extra: { user_id: @user.id, remote_ip: @remote_ip },
        throttle_key: "sse_stream_admission:error:#{@stream_name}:#{e.class}",
        throttle_seconds: 300,
      )
      ServiceResult.failure(errors: ["Unable to open live stream right now"])
    end

    private

    def valid_stream_name?
      SseStreamLease::STREAM_NAMES.include?(@stream_name)
    end

    def report_denial!(message, context)
      Rails.logger.warn(
        "[SSE] stream admission denied stream=#{@stream_name} user_id=#{@user.id} remote_ip=#{@remote_ip} " \
        "user_streams=#{context[:user_streams]} user_limit=#{context[:user_limit]} " \
        "ip_streams=#{context[:ip_streams]} ip_limit=#{context[:ip_limit]} message=#{message}"
      )

      Observability.capture_message(
        message,
        level: :warning,
        tags: { component: "sse_stream_admission", stream: @stream_name, outcome: "denied" },
        extra: context.merge(user_id: @user.id, remote_ip: @remote_ip),
        throttle_key: "sse_stream_admission:denied:#{@stream_name}:#{@user.id}:#{@remote_ip}",
        throttle_seconds: 120,
      )
    end
  end
end
