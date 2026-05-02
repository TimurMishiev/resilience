require "rails_helper"

RSpec.describe Recommendation do
  describe "validations" do
    subject { build(:recommendation) }

    it { is_expected.to be_valid }

    it "rejects invalid recommendation_type" do
      subject.recommendation_type = "nuke_everything"
      expect(subject).not_to be_valid
      expect(subject.errors[:recommendation_type]).to be_present
    end

    it "rejects invalid status" do
      subject.status = "yolo"
      expect(subject).not_to be_valid
    end

    it "rejects invalid tier" do
      subject.tier = "magic"
      expect(subject).not_to be_valid
    end

    it "rejects confidence below 0" do
      subject.confidence = -0.1
      expect(subject).not_to be_valid
    end

    it "rejects confidence above 1" do
      subject.confidence = 1.01
      expect(subject).not_to be_valid
    end

    it "requires rationale" do
      subject.rationale = nil
      expect(subject).not_to be_valid
    end

    it "requires expires_at" do
      subject.expires_at = nil
      expect(subject).not_to be_valid
    end
  end

  describe "scopes" do
    let!(:active_rec)  { create(:recommendation, status: "pending", expires_at: 1.hour.from_now) }
    let!(:expired_rec) { create(:recommendation, status: "pending", expires_at: 1.hour.ago) }
    let!(:accepted_rec) { create(:recommendation, :accepted) }

    describe ".pending" do
      it "returns only pending records" do
        expect(described_class.pending).to include(active_rec, expired_rec)
        expect(described_class.pending).not_to include(accepted_rec)
      end
    end

    describe ".active" do
      it "returns pending records that have not expired" do
        expect(described_class.active).to include(active_rec)
        expect(described_class.active).not_to include(expired_rec, accepted_rec)
      end
    end

    describe ".expired" do
      it "returns pending records past expiry" do
        expect(described_class.expired).to include(expired_rec)
        expect(described_class.expired).not_to include(active_rec, accepted_rec)
      end
    end

    describe ".for_entity" do
      it "filters by entity type and id" do
        result = described_class.for_entity(active_rec.affected_entity_type, active_rec.affected_entity_id)
        expect(result).to include(active_rec)
        expect(result).not_to include(expired_rec)
      end
    end
  end

  describe ".duplicate_pending?" do
    let!(:pending_rec) { create(:recommendation, status: "pending") }

    it "returns true when a matching pending recommendation exists" do
      expect(described_class.duplicate_pending?(
        type: pending_rec.recommendation_type,
        entity_type: pending_rec.affected_entity_type,
        entity_id: pending_rec.affected_entity_id,
      )).to be true
    end

    it "returns false when no match exists" do
      expect(described_class.duplicate_pending?(
        type: "create_task",
        entity_type: "Site",
        entity_id: SecureRandom.uuid,
      )).to be false
    end
  end

  describe "#accept!" do
    let(:recommendation) { create(:recommendation) }
    let(:user) { create(:user, :commander) }

    it "transitions to accepted and records reviewer" do
      recommendation.accept!(user: user, reason: "Good call")

      recommendation.reload
      expect(recommendation.status).to eq("accepted")
      expect(recommendation.reviewed_by_id).to eq(user.id)
      expect(recommendation.reviewed_at).to be_present
      expect(recommendation.review_reason).to eq("Good call")
    end

    it "writes an audit event" do
      expect { recommendation.accept!(user: user) }
        .to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("recommendation_accepted")
      expect(event.entity_id).to eq(recommendation.id)
    end
  end

  describe "#reject!" do
    let(:recommendation) { create(:recommendation) }
    let(:user) { create(:user, :commander) }

    it "transitions to rejected and writes audit event" do
      recommendation.reject!(user: user, reason: "Not relevant")

      recommendation.reload
      expect(recommendation.status).to eq("rejected")
      expect(AuditEvent.last.event_type).to eq("recommendation_rejected")
    end
  end

  describe "#defer!" do
    let(:recommendation) { create(:recommendation) }
    let(:user) { create(:user, :commander) }

    it "transitions to deferred and writes audit event" do
      recommendation.defer!(user: user)

      recommendation.reload
      expect(recommendation.status).to eq("deferred")
      expect(AuditEvent.last.event_type).to eq("recommendation_deferred")
    end
  end

  describe "#expire!" do
    let(:recommendation) { create(:recommendation) }

    it "transitions to expired" do
      recommendation.expire!
      expect(recommendation.reload.status).to eq("expired")
    end
  end

  describe "#mark_executed!" do
    let(:recommendation) { create(:recommendation) }

    it "transitions to executed with timestamp" do
      recommendation.mark_executed!

      recommendation.reload
      expect(recommendation.status).to eq("executed")
      expect(recommendation.executed_at).to be_present
      expect(AuditEvent.last.event_type).to eq("recommendation_executed")
    end
  end

  describe "status predicates" do
    it "#pending? returns true for pending status" do
      expect(build(:recommendation, status: "pending")).to be_pending
    end

    it "#accepted? returns true for accepted status" do
      expect(build(:recommendation, status: "accepted")).to be_accepted
    end

    it "#expired? returns true for expired status" do
      expect(build(:recommendation, status: "expired")).to be_expired
    end
  end

  # Regression for the "concurrent accept/reject/defer race" finding
  # (audit 2026-05-01 P2):
  #
  #   RecommendationsController#accept/reject/defer used to run
  #   `rec.pending? then rec.accept!` outside any lock. Two commanders
  #   clicking Accept simultaneously could both pass the predicate and
  #   each call accept! — the model's accept! transaction wraps update! +
  #   Audit::EventWriter.write, but with_lock was only on #execute. Net
  #   effect: two `recommendation_accepted` audit events for one rec,
  #   last-write-wins on reviewed_by_id and review_reason.
  #
  #   Fix: controller wraps the transition in
  #   `rec.with_lock { unless pending?; return; ...; rec.accept! }`. This
  #   spec proves the model contract the controller relies on: under
  #   genuine concurrency, exactly one of two with_lock blocks observes
  #   pending? as true and accept! is called exactly once.
  #
  # db_concurrency: true switches to truncation so data created here is
  # visible from threads holding their own DB connections (mirrors
  # rule_firing_service_spec.rb's cooldown concurrency spec).
  describe "concurrent accept under with_lock + pending? re-check", db_concurrency: true do
    let!(:concurrent_rec) do
      create(:recommendation, status: "pending", expires_at: 2.hours.from_now)
    end
    let!(:concurrent_user) { create(:user, :commander) }

    it "lets exactly one of two simultaneous accept attempts win" do
      barrier = Concurrent::CyclicBarrier.new(2)
      successes = Concurrent::Array.new
      already   = Concurrent::Array.new
      errors    = Concurrent::Array.new

      threads = 2.times.map do
        Thread.new do
          ActiveRecord::Base.connection_pool.with_connection do
            rec = Recommendation.find(concurrent_rec.id)
            barrier.wait
            rec.with_lock do
              unless rec.pending?
                already << rec.status
                next
              end
              rec.accept!(user: concurrent_user, reason: "race winner")
              successes << rec.status
            end
          rescue StandardError => e
            errors << e
          end
        end
      end

      threads.each do |t|
        t.join(30) || raise("thread did not complete within 30s — likely barrier deadlock from a pre-barrier failure")
      end

      expect(errors).to be_empty,
        "threads raised: #{errors.map { |e| "#{e.class}: #{e.message}" }.join('; ')}"
      expect(successes.size).to eq(1)
      expect(already).to eq(["accepted"])
      expect(concurrent_rec.reload.status).to eq("accepted")
      accept_events = AuditEvent.where(
        entity_type: "Recommendation",
        entity_id:   concurrent_rec.id,
        event_type:  "recommendation_accepted",
      )
      expect(accept_events.count).to eq(1)
    end
  end
end
