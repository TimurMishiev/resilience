require 'rails_helper'

RSpec.describe Incidents::FusionService, type: :service do
  let!(:site) { create(:site) }

  let(:match) do
    create(:signal_rule_match, :without_task,
           site:      site,
           fired_at:  Time.current,
           confidence: 0.75,
           metadata: {
             "distance_km"   => 12.5,
             "signal_type"   => "seismic_event",
             "signal_source" => "usgs_seismic",
             "actions_taken" => []
           })
  end

  describe "#call" do
    context "when no open incident exists for the site" do
      it "creates a new Incident" do
        expect { described_class.call(match: match) }
          .to change(Incident, :count).by(1)
      end

      it "returns success with action: :created" do
        result = described_class.call(match: match)
        expect(result.success).to be true
        expect(result.payload[:action]).to eq :created
      end

      it "sets incident attributes from the match" do
        described_class.call(match: match)
        incident = Incident.last
        expect(incident.site_id).to eq site.id
        expect(incident.severity).to eq "high"       # 0.75 confidence → high
        expect(incident.confidence).to be_within(0.01).of(0.75)
        expect(incident.status).to eq "open"
      end

      it "populates fusion_rationale with rule name and confidence" do
        described_class.call(match: match)
        expect(Incident.last.fusion_rationale).to include("Opened:")
        expect(Incident.last.fusion_rationale).to include("75%")
      end

      it "attaches the match to the new incident" do
        described_class.call(match: match)
        expect(match.reload.incident_id).to eq Incident.last.id
      end
    end

    context "when an open incident already exists within FUSION_WINDOW" do
      let!(:existing) do
        Incident.create!(
          title:     "Existing incident",
          site:      site,
          status:    "open",
          severity:  "low",
          confidence: 0.3,
          opened_at: 2.hours.ago,
          fusion_rationale: "Opened: earlier rule fired."
        )
      end

      it "does not create a new Incident" do
        expect { described_class.call(match: match) }
          .not_to change(Incident, :count)
      end

      it "returns success with action: :attached" do
        result = described_class.call(match: match)
        expect(result.payload[:action]).to eq :attached
        expect(result.payload[:incident].id).to eq existing.id
      end

      it "ratchets severity up to match confidence" do
        described_class.call(match: match)
        expect(existing.reload.severity).to eq "high"
      end

      it "appends to fusion_rationale" do
        described_class.call(match: match)
        expect(existing.reload.fusion_rationale).to include("Opened: earlier rule fired.")
        expect(existing.reload.fusion_rationale).to include("75%")
      end

      it "attaches match to the existing incident" do
        described_class.call(match: match)
        expect(match.reload.incident_id).to eq existing.id
      end
    end

    context "when an open incident exists but is OLDER than FUSION_WINDOW" do
      let!(:old_incident) do
        Incident.create!(
          title:     "Old incident",
          site:      site,
          status:    "open",
          opened_at: 10.hours.ago,
          severity:  "low",
          confidence: 0.3
        ).tap { |i| i.update_column(:updated_at, 7.hours.ago) }
      end

      it "creates a new incident rather than attaching to the stale one" do
        expect { described_class.call(match: match) }
          .to change(Incident, :count).by(1)
      end
    end

    context "when match has no site_id" do
      let(:siteless_match) do
        create(:signal_rule_match, :without_task,
               site_id:    nil,
               fired_at:   Time.current,
               confidence: 0.5,
               metadata: {
                 "distance_km"   => 0.0,
                 "signal_type"   => "seismic_event",
                 "signal_source" => "usgs_seismic",
                 "actions_taken" => []
               })
      end

      it "skips fusion and returns :skipped" do
        result = described_class.call(match: siteless_match)
        expect(result.success).to be true
        expect(result.payload[:action]).to eq :skipped
        expect(Incident.count).to eq 0
      end
    end

    context "severity thresholds" do
      [
        [0.85, "critical"],
        [0.65, "high"],
        [0.45, "moderate"],
        [0.2,  "low"],
      ].each do |conf, expected_severity|
        it "maps confidence #{conf} → severity #{expected_severity}" do
          m = create(:signal_rule_match, :without_task,
                     site:      site,
                     confidence: conf,
                     metadata: { "distance_km" => 10.0, "signal_type" => "seismic_event",
                                 "signal_source" => "usgs_seismic", "actions_taken" => [] })
          described_class.call(match: m)
          expect(Incident.last.severity).to eq expected_severity
        end
      end
    end
  end
end
