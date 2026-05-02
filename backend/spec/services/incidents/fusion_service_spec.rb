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

      it "writes an incident.opened audit event" do
        expect { described_class.call(match: match) }.to change(AuditEvent, :count).by(1)
        audit = AuditEvent.last
        expect(audit.event_type).to eq("incident.opened")
        expect(audit.actor).to eq("system")
        expect(audit.entity_type).to eq("Incident")
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

      it "writes an incident.fusion_attached audit event" do
        expect { described_class.call(match: match) }.to change(AuditEvent, :count).by(1)
        audit = AuditEvent.last
        expect(audit.event_type).to eq("incident.fusion_attached")
        expect(audit.entity_id).to eq(existing.id)
        expect(audit.metadata["match_id"]).to eq(match.id)
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

    context "when fusion_rationale is at or near the byte cap" do
      it "does not grow the rationale beyond RATIONALE_MAX_BYTES" do
        # Pre-fill the rationale to just below the cap so the next fusion triggers truncation.
        near_full = "x" * (described_class::RATIONALE_MAX_BYTES - 10)
        existing = Incident.create!(
          title:            "High-frequency incident",
          site:             site,
          status:           "open",
          severity:         "low",
          confidence:       0.3,
          opened_at:        1.hour.ago,
          fusion_rationale: near_full
        )

        described_class.call(match: match)

        rationale = existing.reload.fusion_rationale
        expect(rationale.bytesize).to be <= described_class::RATIONALE_MAX_BYTES + described_class::RATIONALE_OVERFLOW.bytesize
        expect(rationale).to end_with(described_class::RATIONALE_OVERFLOW)
      end

      it "preserves context from the fusion that first triggers overflow" do
        near_full = "x" * (described_class::RATIONALE_MAX_BYTES - 10)
        existing = Incident.create!(
          title:            "High-frequency incident",
          site:             site,
          status:           "open",
          severity:         "low",
          confidence:       0.3,
          opened_at:        1.hour.ago,
          fusion_rationale: near_full
        )

        described_class.call(match: match)

        rationale = existing.reload.fusion_rationale
        expect(rationale).to include("[latest:")
        expect(rationale).to include("Rule")
        expect(rationale).to include("75%")
        expect(rationale).to end_with(described_class::RATIONALE_OVERFLOW)
      end

      it "does not append the overflow sentinel more than once" do
        already_capped = "Opened: earlier." + described_class::RATIONALE_OVERFLOW
        existing = Incident.create!(
          title:            "Already-capped incident",
          site:             site,
          status:           "open",
          severity:         "low",
          confidence:       0.3,
          opened_at:        1.hour.ago,
          fusion_rationale: already_capped
        )

        2.times { described_class.call(match: match) }
        match2 = create(:signal_rule_match, :without_task,
                        site: site, confidence: 0.6,
                        metadata: { "distance_km" => 5.0, "signal_type" => "seismic_event",
                                    "signal_source" => "usgs_seismic", "actions_taken" => [] })
        described_class.call(match: match2)

        rationale = existing.reload.fusion_rationale
        expect(rationale.scan(described_class::RATIONALE_OVERFLOW).size).to eq(1)
      end

      it "still updates confidence and severity when rationale is capped" do
        already_capped = "Opened: earlier." + described_class::RATIONALE_OVERFLOW
        existing = Incident.create!(
          title:            "Capped but still live",
          site:             site,
          status:           "open",
          severity:         "low",
          confidence:       0.2,
          opened_at:        1.hour.ago,
          fusion_rationale: already_capped
        )

        described_class.call(match: match)  # confidence 0.75 → severity high

        expect(existing.reload.severity).to eq("high")
        expect(existing.reload.confidence).to be_within(0.01).of(0.75)
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

    # Regression for the "partial-select Site silently breaks geofence
    # incident fusion" bug (audit 2026-05-01 P1):
    #
    #   `EvaluateRecentJob` loads sites via `Site.active.select(:id,
    #   :name, :latitude, :longitude, :geofence_radius_km)` to keep the
    #   correlation hot path's memory footprint bounded. Pre-fix, this
    #   omitted `area_of_operation_id`. The partial Site is passed to
    #   `Sites::GeofenceBreachService`, which calls
    #   `SignalRuleMatch.create!(site: <partial_site>)`. AR caches the
    #   passed-in partial AR object on the new record. When
    #   `Incidents::FusionService` then ran
    #   `@match.site&.area_of_operation_id` it raised
    #   `ActiveModel::MissingAttributeError`. The caller swallowed it
    #   in a broad rescue → SignalRuleMatch persisted, no Incident.
    #
    #   Two-layer fix:
    #     1. The partial select now includes area_of_operation_id.
    #     2. FusionService captures the FOR-UPDATE-locked Site row
    #        (always full columns) and reads area_of_operation_id from
    #        THAT row instead of the cached match.site association.
    #
    #   This spec proves the consumer fix (#2) is durable: it constructs
    #   a SignalRuleMatch with a partial-selected Site that's missing
    #   area_of_operation_id, runs FusionService against it, and asserts
    #   no MissingAttributeError + the Incident is created with the
    #   correct area_of_operation_id pulled from the locked row.
    context "when match.site is a partial-select AR object missing area_of_operation_id" do
      let!(:ao) do
        AreaOfOperation.create!(
          name: "Partial-Select Test AO",
          threat_level: "amber",
          posture: "defensive",
          color: "#ffdd57",
          geometry: { "type" => "Polygon", "coordinates" => [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
          created_by: create(:user, :commander),
        )
      end
      let!(:full_site) { create(:site, area_of_operation: ao) }
      # Mimic EvaluateRecentJob's partial select. The returned AR object
      # has only the listed columns loaded; accessing other attributes
      # raises ActiveModel::MissingAttributeError.
      let(:partial_site) do
        Site.where(id: full_site.id)
            .select(:id, :name, :latitude, :longitude, :geofence_radius_km)
            .first
      end
      let(:match_with_partial_site) do
        # Create the SignalRuleMatch using the partial-selected site so
        # match.site (the cached association) is the partial AR object.
        create(:signal_rule_match, :without_task,
               site:      partial_site,
               fired_at:  Time.current,
               confidence: 0.75,
               metadata: {
                 "distance_km"   => 5.0,
                 "signal_type"   => "seismic_event",
                 "signal_source" => "usgs_seismic",
                 "actions_taken" => [],
               })
      end

      it "does not raise MissingAttributeError when accessing area_of_operation_id" do
        # Sanity-check the fixture: the cached site IS partial.
        expect {
          match_with_partial_site.site.area_of_operation_id
        }.to raise_error(ActiveModel::MissingAttributeError)

        expect {
          described_class.call(match: match_with_partial_site)
        }.not_to raise_error
      end

      it "creates an Incident with the correct area_of_operation_id from the freshly-locked row" do
        result = described_class.call(match: match_with_partial_site)
        expect(result).to be_success
        incident = Incident.last
        expect(incident.area_of_operation_id).to eq(ao.id)
        expect(incident.site_id).to eq(full_site.id)
      end
    end
  end
end
