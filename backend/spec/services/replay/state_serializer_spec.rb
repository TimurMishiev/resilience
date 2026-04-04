require "rails_helper"

RSpec.describe Replay::StateSerializer, type: :service do
  let(:cutoff) { 1.hour.ago.change(usec: 0) }

  describe ".match_states" do
    it "reconstructs workflow state from audit snapshots" do
      match = create(:signal_rule_match, workflow_status: "acknowledged")
      user  = create(:user, :commander)

      create(
        :audit_event,
        entity_type: "SignalRuleMatch",
        entity_id: match.id,
        event_type: "alert.created",
        after_snapshot: { workflow_status: "unacknowledged" },
        occurred_at: cutoff - 2.hours,
      )
      create(
        :audit_event,
        entity_type: "SignalRuleMatch",
        entity_id: match.id,
        event_type: "alert.acknowledged",
        after_snapshot: {
          workflow_status: "acknowledged",
          acknowledged_at: (cutoff - 30.minutes).iso8601,
          acknowledged_by_id: user.id,
          notes: "Checked and confirmed",
        },
        occurred_at: cutoff - 30.minutes,
      )

      states = described_class.match_states([match], as_of: cutoff)
      state  = states.fetch(match.id)

      expect(state[:workflow_status]).to eq("acknowledged")
      expect(state[:notes]).to eq("Checked and confirmed")
      expect(state[:acknowledged_by]).to eq({ id: user.id, email: user.email })
    end

    it "returns defaults for matches with no audit trail" do
      match = create(:signal_rule_match)

      states = described_class.match_states([match], as_of: cutoff)
      state  = states.fetch(match.id)

      expect(state[:workflow_status]).to eq("unacknowledged")
      expect(state[:acknowledged_at]).to be_nil
      expect(state[:notes]).to be_nil
      expect(state[:acknowledged_by]).to be_nil
    end

    it "returns empty hash for empty input" do
      states = described_class.match_states([], as_of: cutoff)
      expect(states).to eq({})
    end
  end

  describe ".recommendation_states" do
    it "reconstructs status from audit snapshots" do
      rec = create(:recommendation, :accepted, reviewed_at: cutoff - 20.minutes, expires_at: 2.hours.from_now)
      reviewer = create(:user, :commander)
      rec.update_columns(reviewed_by_id: reviewer.id, review_reason: "Looks good")

      create(
        :audit_event,
        entity_type: "Recommendation",
        entity_id: rec.id,
        event_type: "recommendation.accepted",
        after_snapshot: { status: "accepted", review_reason: "Looks good" },
        occurred_at: cutoff - 20.minutes,
      )

      states = described_class.recommendation_states([rec], as_of: cutoff)
      state  = states.fetch(rec.id)

      expect(state[:status]).to eq("accepted")
      expect(state[:reviewed_by]).to include(id: reviewer.id)
      expect(state[:review_reason]).to eq("Looks good")
    end

    it "synthesizes expired status for pending recommendations past expires_at" do
      rec = create(:recommendation, status: "pending", expires_at: cutoff - 10.minutes)

      states = described_class.recommendation_states([rec], as_of: cutoff)
      state  = states.fetch(rec.id)

      expect(state[:status]).to eq("expired")
      expect(state[:reviewed_by]).to be_nil
      expect(state[:executed_at]).to be_nil
    end

    it "keeps pending status when recommendation has not yet expired" do
      rec = create(:recommendation, status: "pending", expires_at: cutoff + 1.hour)

      states = described_class.recommendation_states([rec], as_of: cutoff)
      state  = states.fetch(rec.id)

      expect(state[:status]).to eq("pending")
    end

    it "returns defaults for recommendations with no audit trail" do
      rec = create(:recommendation, status: "pending", expires_at: cutoff + 1.hour)

      states = described_class.recommendation_states([rec], as_of: cutoff)
      state  = states.fetch(rec.id)

      expect(state[:status]).to eq("pending")
      expect(state[:reviewed_by]).to be_nil
      expect(state[:reviewed_at]).to be_nil
      expect(state[:review_reason]).to be_nil
      expect(state[:executed_at]).to be_nil
    end

    it "returns empty hash for empty input" do
      states = described_class.recommendation_states([], as_of: cutoff)
      expect(states).to eq({})
    end
  end
end
