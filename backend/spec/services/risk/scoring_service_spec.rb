require "rails_helper"

RSpec.describe Risk::ScoringService, type: :service do
  # Site in the Gulf of Aden — coordinates match our seed data pattern.
  let(:site) { create(:site, latitude: 11.5, longitude: 43.1) }

  subject(:result) { described_class.call(site: site, readiness_score: readiness_score) }

  let(:readiness_score) { nil }

  it "returns a successful result" do
    expect(result.success).to be true
  end

  it "includes required fields in payload" do
    expect(result.payload.keys).to contain_exactly(
      :site_id, :site_name, :score, :risk_level, :components, :computed_at
    )
  end

  it "returns site metadata" do
    expect(result.payload[:site_id]).to   eq(site.id)
    expect(result.payload[:site_name]).to eq(site.name)
  end

  # ── Alert pressure component ───────────────────────────────────────────────

  describe "alert pressure" do
    context "with no open matches" do
      it "contributes 0 alert pressure" do
        expect(result.payload[:components][:alert_pressure]).to eq(0.0)
      end
    end

    context "with one high-confidence open match" do
      before do
        create(:signal_rule_match,
               site:             site,
               confidence:       1.0,
               workflow_status:  "unacknowledged",
               fired_at:         1.hour.ago)
      end

      it "contributes 20 points of alert pressure" do
        expect(result.payload[:components][:alert_pressure]).to eq(20.0)
      end
    end

    context "with two high-confidence open matches" do
      before do
        create_list(:signal_rule_match, 2,
                    site:            site,
                    confidence:      1.0,
                    workflow_status: "unacknowledged",
                    fired_at:        1.hour.ago)
      end

      it "caps alert pressure at 40" do
        expect(result.payload[:components][:alert_pressure]).to eq(40.0)
      end
    end

    context "with a closed match" do
      before do
        create(:signal_rule_match,
               site:            site,
               confidence:      1.0,
               workflow_status: "closed",
               fired_at:        1.hour.ago)
      end

      it "ignores closed matches" do
        expect(result.payload[:components][:alert_pressure]).to eq(0.0)
      end
    end

    context "with a match outside the 72h window" do
      before do
        create(:signal_rule_match,
               site:            site,
               confidence:      1.0,
               workflow_status: "unacknowledged",
               fired_at:        80.hours.ago)
      end

      it "ignores stale matches" do
        expect(result.payload[:components][:alert_pressure]).to eq(0.0)
      end
    end
  end

  # ── Task health component ──────────────────────────────────────────────────

  describe "task health pressure" do
    context "when readiness_score is nil (no tasks)" do
      let(:readiness_score) { nil }

      it "contributes 0 task health pressure" do
        expect(result.payload[:components][:task_health]).to eq(0.0)
      end
    end

    context "when readiness_score is 1.0 (fully resolved)" do
      let(:readiness_score) { 1.0 }

      it "contributes 0 task health pressure" do
        expect(result.payload[:components][:task_health]).to eq(0.0)
      end
    end

    context "when readiness_score is 0.0 (all blocked)" do
      let(:readiness_score) { 0.0 }

      it "contributes full 30 points of task health pressure" do
        expect(result.payload[:components][:task_health]).to eq(30.0)
      end
    end

    context "when readiness_score is 0.5" do
      let(:readiness_score) { 0.5 }

      it "contributes 15 points" do
        expect(result.payload[:components][:task_health]).to eq(15.0)
      end
    end
  end

  # ── Signal density component ───────────────────────────────────────────────

  describe "signal density" do
    context "with no nearby signals" do
      it "contributes 0 signal density pressure" do
        expect(result.payload[:components][:signal_density]).to eq(0.0)
      end
    end

    context "with signals close to site (within 100km)" do
      before do
        # ~15km from site at (11.5, 43.1)
        create(:external_signal, lat: 11.6, lng: 43.2, occurred_at: 1.hour.ago)
        create(:external_signal, lat: 11.4, lng: 43.0, occurred_at: 2.hours.ago)
      end

      it "includes nearby signals in density count" do
        expect(result.payload[:components][:signal_density]).to eq(4.0) # 2 signals × 2
      end
    end

    context "with signals older than 24h" do
      before do
        create(:external_signal, lat: 11.6, lng: 43.2, occurred_at: 25.hours.ago)
      end

      it "ignores signals outside the time window" do
        expect(result.payload[:components][:signal_density]).to eq(0.0)
      end
    end

    context "with signals far from site (beyond 100km)" do
      before do
        # ~500km away
        create(:external_signal, lat: 16.0, lng: 43.1, occurred_at: 1.hour.ago)
      end

      it "ignores distant signals" do
        expect(result.payload[:components][:signal_density]).to eq(0.0)
      end
    end

    context "when density reaches cap" do
      before do
        # 15 signals nearby — each contributes 2 pts, cap is 30
        create_list(:external_signal, 15, lat: 11.6, lng: 43.2, occurred_at: 1.hour.ago)
      end

      it "caps signal density at 30" do
        expect(result.payload[:components][:signal_density]).to eq(30.0)
      end
    end
  end

  # ── Total score and risk level ────────────────────────────────────────────

  describe "total score and risk level" do
    context "with no threats (clean site)" do
      let(:readiness_score) { 1.0 }

      it "returns score 0 and level low" do
        expect(result.payload[:score]).to eq(0)
        expect(result.payload[:risk_level]).to eq("low")
      end
    end

    context "with moderate threat (some alerts, partial readiness)" do
      let(:readiness_score) { 0.5 } # → 15 pts task health

      before do
        create(:signal_rule_match,
               site:            site,
               confidence:      0.8,
               workflow_status: "investigating",
               fired_at:        2.hours.ago)
      end

      it "returns moderate risk level" do
        # alert: 0.8 * 20 = 16, task_health: 15, density: 0 → total = 31
        expect(result.payload[:score]).to eq(31)
        expect(result.payload[:risk_level]).to eq("moderate")
      end
    end

    context "with maximum threat (two high-conf alerts + all-blocked + dense signals)" do
      let(:readiness_score) { 0.0 } # → 30 pts task health

      before do
        create_list(:signal_rule_match, 2,
                    site:            site,
                    confidence:      1.0,
                    workflow_status: "unacknowledged",
                    fired_at:        1.hour.ago)

        create_list(:external_signal, 15, lat: 11.6, lng: 43.2, occurred_at: 1.hour.ago)
      end

      it "returns score 100 and level critical" do
        expect(result.payload[:score]).to eq(100)
        expect(result.payload[:risk_level]).to eq("critical")
      end
    end
  end

  # ── Risk level thresholds ─────────────────────────────────────────────────

  describe "risk level classification" do
    [
      [0,   "low"],
      [25,  "low"],
      [26,  "moderate"],
      [50,  "moderate"],
      [51,  "high"],
      [75,  "high"],
      [76,  "critical"],
      [100, "critical"]
    ].each do |score, expected_level|
      it "classifies score #{score} as #{expected_level}" do
        # Use readiness_score to construct a predictable score via task_health component:
        # task_health = (1.0 - readiness) * 30
        # Set readiness so task_health ≈ score (clamped at 30, so only tests up to 30 this way)
        # For scores > 30, we rely on the integration tests above.
        service = described_class.new(site: site, readiness_score: nil)
        level   = service.send(:resolve_level, score)
        expect(level).to eq(expected_level)
      end
    end
  end
end
