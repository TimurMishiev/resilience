require "rails_helper"

RSpec.describe Incident do
  describe "validations" do
    subject { build(:incident) }

    it { is_expected.to be_valid }

    it "requires title" do
      subject.title = nil
      expect(subject).not_to be_valid
    end

    it "rejects invalid status" do
      subject.status = "exploded"
      expect(subject).not_to be_valid
    end

    it "rejects invalid severity" do
      subject.severity = "cosmic"
      expect(subject).not_to be_valid
    end

    it "rejects confidence below 0" do
      subject.confidence = -0.5
      expect(subject).not_to be_valid
    end

    it "rejects confidence above 1" do
      subject.confidence = 1.5
      expect(subject).not_to be_valid
    end

    it "requires opened_at" do
      subject.opened_at = nil
      expect(subject).not_to be_valid
    end

    it "accepts valid prosecution_phase" do
      subject.prosecution_phase = "assessing"
      expect(subject).to be_valid
    end

    it "rejects invalid prosecution_phase" do
      subject.prosecution_phase = "bombing"
      expect(subject).not_to be_valid
    end

    it "allows nil prosecution_phase" do
      subject.prosecution_phase = nil
      expect(subject).to be_valid
    end
  end

  describe "scopes" do
    let!(:open_inc)     { create(:incident, status: "open") }
    let!(:acked_inc)    { create(:incident, :acknowledged) }
    let!(:closed_inc)   { create(:incident, :closed) }
    let!(:critical_inc) { create(:incident, :critical) }

    describe ".active" do
      it "excludes resolved and closed" do
        expect(described_class.active).to include(open_inc, acked_inc, critical_inc)
        expect(described_class.active).not_to include(closed_inc)
      end
    end

    describe ".by_severity" do
      it "orders critical first" do
        results = described_class.by_severity.to_a
        critical_idx = results.index(critical_inc)
        open_idx     = results.index(open_inc)
        expect(critical_idx).to be < open_idx
      end
    end

    describe ".for_site" do
      it "filters by site_id" do
        result = described_class.for_site(open_inc.site_id)
        expect(result).to include(open_inc)
      end
    end
  end

  describe "#allowed_transitions" do
    it "returns valid next statuses from open" do
      incident = build(:incident, status: "open")
      expect(incident.allowed_transitions).to eq(%w[acknowledged contained resolved closed])
    end

    it "returns valid next statuses from acknowledged" do
      incident = build(:incident, status: "acknowledged")
      expect(incident.allowed_transitions).to include("contained", "resolved", "closed", "open")
    end

    it "allows reopen from closed" do
      incident = build(:incident, status: "closed")
      expect(incident.allowed_transitions).to eq(%w[open])
    end
  end

  describe "#severity_rank" do
    it "returns 0 for low" do
      expect(build(:incident, severity: "low").severity_rank).to eq(0)
    end

    it "returns 3 for critical" do
      expect(build(:incident, severity: "critical").severity_rank).to eq(3)
    end
  end

  describe "prosecution helpers" do
    it "#being_prosecuted? returns true when phase is set" do
      incident = build(:incident, prosecution_phase: "assessing")
      expect(incident).to be_being_prosecuted
    end

    it "#being_prosecuted? returns false when phase is nil" do
      incident = build(:incident, prosecution_phase: nil)
      expect(incident).not_to be_being_prosecuted
    end

    it "#prosecution_concluded? returns true only for concluded" do
      expect(build(:incident, prosecution_phase: "concluded")).to be_prosecution_concluded
      expect(build(:incident, prosecution_phase: "executing")).not_to be_prosecution_concluded
    end
  end

  describe "associations" do
    it "belongs_to site optionally" do
      incident = build(:incident, site: nil)
      incident.area_of_operation = create(:area_of_operation)
      expect(incident).to be_valid
    end

    it "prevents destroy when notes exist" do
      incident = create(:incident)
      create(:incident_note, incident: incident)
      expect { incident.destroy! }.to raise_error(ActiveRecord::DeleteRestrictionError)
    end
  end
end
