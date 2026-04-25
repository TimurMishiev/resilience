require "rails_helper"

RSpec.describe IngestionCursor, type: :model do
  include ActiveSupport::Testing::TimeHelpers

  describe ".for" do
    it "creates a new cursor anchored initial_lookback in the past on first call" do
      freeze_time = Time.zone.parse("2026-04-22 10:00:00 UTC")
      travel_to(freeze_time) do
        cursor = described_class.for("test.consumer", initial_lookback: 90.seconds)

        expect(cursor).to be_persisted
        expect(cursor.name).to eq("test.consumer")
        expect(cursor.last_ingested_at).to be_within(0.01).of(freeze_time - 90.seconds)
        expect(cursor.last_signal_id).to be_nil
      end
    end

    it "returns the existing cursor on subsequent calls" do
      first = described_class.for("test.consumer")
      second = described_class.for("test.consumer")

      expect(second.id).to eq(first.id)
      expect(described_class.where(name: "test.consumer").count).to eq(1)
    end

    it "rescues RecordNotUnique on race and returns the winning row" do
      # Simulate two workers booting simultaneously: the first
      # find_or_create_by! call inside the rescue context returns nil,
      # then the second one (the recovery) finds the row another worker
      # raced and inserted in between.
      preexisting = described_class.create!(
        name: "test.consumer",
        last_ingested_at: 5.minutes.ago,
      )

      # Force the find_or_create path to think there's no row, attempt
      # an insert, hit the unique index, and recover via find_by.
      allow(described_class).to receive(:find_or_create_by!).and_raise(
        ActiveRecord::RecordNotUnique.new("simulated race")
      )

      result = described_class.for("test.consumer")

      expect(result.id).to eq(preexisting.id)
    end
  end

  describe "#signals_since" do
    let(:cursor) { described_class.create!(name: "test", last_ingested_at: 1.hour.ago) }

    def make_signal(ingested_at:, external_id:)
      ExternalSignal.create!(
        source: "usgs_seismic",
        signal_type: "seismic_event",
        external_id: external_id,
        lat: 0.0,
        lng: 0.0,
        occurred_at: ingested_at,
        ingested_at: ingested_at,
        raw_payload: {},
      )
    end

    it "returns only signals ingested strictly after last_ingested_at when no last_signal_id" do
      before_cursor = make_signal(ingested_at: 2.hours.ago, external_id: "before")
      after_cursor  = make_signal(ingested_at: 30.minutes.ago, external_id: "after")

      ids = cursor.signals_since.pluck(:id)
      expect(ids).to include(after_cursor.id)
      expect(ids).not_to include(before_cursor.id)
    end

    it "applies the tuple inequality when last_signal_id is present (handles same-microsecond ties)" do
      shared_ts = 30.minutes.ago.change(usec: 123_456)
      sibling_a = make_signal(ingested_at: shared_ts, external_id: "tie-a")
      sibling_b = make_signal(ingested_at: shared_ts, external_id: "tie-b")

      # Sort the two siblings by id so the smaller is the cursor anchor;
      # the larger should still be picked up despite identical occurred_at.
      earlier_id, later_id = [sibling_a.id, sibling_b.id].sort

      cursor.update!(last_ingested_at: shared_ts, last_signal_id: earlier_id)

      ids = cursor.signals_since.pluck(:id)
      expect(ids).to contain_exactly(later_id)
    end

    it "orders results by (ingested_at, id) ascending so the last popped row is the new high-water mark" do
      first  = make_signal(ingested_at: 30.minutes.ago, external_id: "first")
      second = make_signal(ingested_at: 20.minutes.ago, external_id: "second")
      third  = make_signal(ingested_at: 10.minutes.ago, external_id: "third")

      result = cursor.signals_since.pluck(:id, :ingested_at)

      expect(result.first.first).to eq(first.id)
      expect(result.last.first).to eq(third.id)
      expect(result.map(&:last)).to eq(result.map(&:last).sort)
      expect(result.map(&:first)).to include(second.id)
    end
  end

  describe "#advance_to" do
    let(:cursor) { described_class.create!(name: "test", last_ingested_at: 1.hour.ago) }

    def make_signal_at(ts, external_id)
      ExternalSignal.create!(
        source: "usgs_seismic",
        signal_type: "seismic_event",
        external_id: external_id,
        lat: 0.0,
        lng: 0.0,
        occurred_at: ts,
        ingested_at: ts,
        raw_payload: {},
      )
    end

    it "advances to a strictly-greater signal" do
      signal = make_signal_at(30.minutes.ago, "advance")

      cursor.advance_to(signal)

      expect(cursor.reload.last_ingested_at).to be_within(0.01).of(signal.ingested_at)
      expect(cursor.last_signal_id).to eq(signal.id)
    end

    it "is a no-op when the signal is nil" do
      expect { cursor.advance_to(nil) }.not_to change { cursor.reload.attributes }
    end

    it "does NOT regress the cursor when given an earlier signal (race safety)" do
      # Simulates a concurrent-worker race where two ticks each try to
      # advance_to. The atomic UPDATE ... WHERE guards against the
      # earlier signal's call overwriting the later signal's already-
      # advanced state.
      later   = make_signal_at(10.minutes.ago, "later")
      earlier = make_signal_at(40.minutes.ago, "earlier")

      cursor.advance_to(later)
      anchor = cursor.reload.last_ingested_at

      cursor.advance_to(earlier)

      expect(cursor.reload.last_ingested_at).to eq(anchor)
      expect(cursor.last_signal_id).to eq(later.id)
    end

    it "does not regress when the same timestamp arrives with a lexicographically-smaller UUID" do
      shared_ts = 30.minutes.ago.change(usec: 0)
      a = make_signal_at(shared_ts, "tie-a")
      b = make_signal_at(shared_ts, "tie-b")

      larger_id, smaller_id = [a.id, b.id].sort.reverse
      larger_signal  = ExternalSignal.find(larger_id)
      smaller_signal = ExternalSignal.find(smaller_id)

      cursor.advance_to(larger_signal)
      cursor.advance_to(smaller_signal)

      expect(cursor.reload.last_signal_id).to eq(larger_id)
    end

    it "issues an atomic UPDATE ... WHERE rather than a read-then-write" do
      signal = make_signal_at(30.minutes.ago, "atomic")

      # Spy on the relation chain. The fix must build a guarded scope
      # before update_all — a plain `update!` would skip these calls.
      relation = described_class.where(id: cursor.id)
      allow(described_class).to receive(:where).with(id: cursor.id).and_return(relation)
      expect(relation).to receive(:where).and_call_original
      expect_any_instance_of(ActiveRecord::Relation).to receive(:update_all).and_call_original

      cursor.advance_to(signal)
    end
  end
end
