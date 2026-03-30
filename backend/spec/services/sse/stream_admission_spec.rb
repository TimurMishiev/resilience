require "rails_helper"

RSpec.describe Sse::StreamAdmission do
  include ActiveSupport::Testing::TimeHelpers

  let(:user) { create(:user) }
  let(:other_user) { create(:user) }
  let(:remote_ip) { "127.0.0.1" }

  around do |example|
    original_user_limit = ENV["SSE_MAX_STREAMS_PER_USER"]
    original_ip_limit = ENV["SSE_MAX_STREAMS_PER_IP"]
    original_ttl = ENV["SSE_STREAM_LEASE_TTL_SECONDS"]

    ENV["SSE_MAX_STREAMS_PER_USER"] = "2"
    ENV["SSE_MAX_STREAMS_PER_IP"] = "3"
    ENV["SSE_STREAM_LEASE_TTL_SECONDS"] = "180"

    example.run
  ensure
    original_user_limit ? ENV["SSE_MAX_STREAMS_PER_USER"] = original_user_limit : ENV.delete("SSE_MAX_STREAMS_PER_USER")
    original_ip_limit ? ENV["SSE_MAX_STREAMS_PER_IP"] = original_ip_limit : ENV.delete("SSE_MAX_STREAMS_PER_IP")
    original_ttl ? ENV["SSE_STREAM_LEASE_TTL_SECONDS"] = original_ttl : ENV.delete("SSE_STREAM_LEASE_TTL_SECONDS")
  end

  describe ".acquire" do
    it "rejects an unrecognised stream name" do
      result = described_class.acquire(stream_name: "bogus", user: user, remote_ip: remote_ip)

      expect(result.success).to eq(false)
      expect(result.errors).to contain_exactly("Unknown SSE stream: bogus")
      expect(SseStreamLease.count).to eq(0)
    end

    it "creates an active lease handle" do
      result = described_class.acquire(stream_name: "events", user: user, remote_ip: remote_ip)

      expect(result.success).to eq(true)
      expect(result.payload.fetch(:lease)).to be_a(described_class::LeaseHandle)
      expect(SseStreamLease.count).to eq(1)

      lease = SseStreamLease.first
      expect(lease.user_id).to eq(user.id)
      expect(lease.stream_name).to eq("events")
      expect(lease.remote_ip).to eq(remote_ip)
      expect(lease.expires_at).to be > Time.current
    end

    it "rejects when the same user is already at the live stream limit" do
      2.times do |index|
        SseStreamLease.create!(
          user: user,
          stream_name: index.zero? ? "events" : "telemetry",
          remote_ip: remote_ip,
          lease_key: SecureRandom.uuid,
          expires_at: 5.minutes.from_now,
        )
      end

      result = described_class.acquire(stream_name: "signals", user: user, remote_ip: remote_ip)

      expect(result.success).to eq(false)
      expect(result.errors).to contain_exactly(
        "Too many live streams are already open for this user. Close another live tab and retry.",
      )
      expect(SseStreamLease.count).to eq(2)
    end

    it "rejects when the remote IP is already at the live stream limit" do
      3.times do |index|
        SseStreamLease.create!(
          user: index.zero? ? user : other_user,
          stream_name: SseStreamLease::STREAM_NAMES[index],
          remote_ip: remote_ip,
          lease_key: SecureRandom.uuid,
          expires_at: 5.minutes.from_now,
        )
      end

      result = described_class.acquire(stream_name: "events", user: create(:user), remote_ip: remote_ip)

      expect(result.success).to eq(false)
      expect(result.errors).to contain_exactly(
        "Too many live streams are already open from this network. Retry shortly.",
      )
      expect(SseStreamLease.count).to eq(3)
    end

    it "drops expired leases before counting capacity" do
      SseStreamLease.create!(
        user: user,
        stream_name: "events",
        remote_ip: remote_ip,
        lease_key: SecureRandom.uuid,
        expires_at: 1.second.ago,
      )

      result = described_class.acquire(stream_name: "telemetry", user: user, remote_ip: remote_ip)

      expect(result.success).to eq(true)
      expect(SseStreamLease.count).to eq(1)
      expect(SseStreamLease.first.stream_name).to eq("telemetry")
    end
  end

  describe described_class::LeaseHandle do
    it "refreshes the lease near expiry and releases it cleanly" do
      freeze_time do
        result = Sse::StreamAdmission.acquire(stream_name: "signals", user: user, remote_ip: remote_ip)
        lease = result.payload.fetch(:lease)
        lease_record = SseStreamLease.find(lease.record.id)
        original_expiry = lease_record.expires_at

        travel 121.seconds

        expect { lease.refresh_if_needed! }
          .to change { lease_record.reload.expires_at }
          .to(be > original_expiry)

        expect { lease.release! }.to change(SseStreamLease, :count).from(1).to(0)
      end
    end
  end
end
