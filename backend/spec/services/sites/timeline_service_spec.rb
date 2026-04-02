require "rails_helper"

RSpec.describe Sites::TimelineService, type: :service do
  # Fixed coordinates — Strait of Hormuz area.
  let(:site) { create(:site, latitude: 26.5, longitude: 56.2) }

  subject(:events) { described_class.call(site: site, days: 7) }

  # ── signal_detected events ─────────────────────────────────────────────────

  describe "signal_detected" do
    context "when a signal is within 200 km" do
      let!(:near_signal) do
        create(:external_signal,
               lat:         26.6, # ~11 km north
               lng:         56.2,
               signal_type: "seismic_event",
               source:      "usgs_seismic",
               occurred_at: 2.days.ago)
      end

      it "includes the signal as a signal_detected event" do
        ids = events.map { |e| e[:id] }
        expect(ids).to include("sig_#{near_signal.id}")
      end

      it "sets event_kind to signal_detected" do
        e = events.find { |ev| ev[:id] == "sig_#{near_signal.id}" }
        expect(e[:event_kind]).to eq("signal_detected")
      end

      it "includes distance_km in meta" do
        e = events.find { |ev| ev[:id] == "sig_#{near_signal.id}" }
        expect(e[:meta][:distance_km]).to be_a(Numeric)
        expect(e[:meta][:distance_km]).to be < 200
      end

      it "builds a descriptive title with distance" do
        e = events.find { |ev| ev[:id] == "sig_#{near_signal.id}" }
        expect(e[:title]).to match(/Seismic event detected .* km away/)
      end
    end

    context "when a signal is beyond 200 km" do
      let!(:far_signal) do
        create(:external_signal,
               lat:         28.5, # ~220 km north
               lng:         56.2,
               occurred_at: 1.day.ago)
      end

      it "excludes the signal" do
        ids = events.map { |e| e[:id] }
        expect(ids).not_to include("sig_#{far_signal.id}")
      end
    end

    context "when a signal is outside the lookback window" do
      let!(:old_signal) do
        create(:external_signal,
               lat:         26.6,
               lng:         56.2,
               occurred_at: 10.days.ago)
      end

      it "excludes the signal" do
        ids = events.map { |e| e[:id] }
        expect(ids).not_to include("sig_#{old_signal.id}")
      end
    end

    context "when a signal occurs after as_of" do
      let!(:future_signal) do
        create(:external_signal,
               lat:         26.6,
               lng:         56.2,
               occurred_at: 2.hours.ago)
      end

      it "excludes the signal from a historical replay window" do
        historical_events = described_class.call(site: site, days: 7, as_of: 3.hours.ago)
        ids = historical_events.map { |e| e[:id] }
        expect(ids).not_to include("sig_#{future_signal.id}")
      end
    end
  end

  # ── rule_fired events ──────────────────────────────────────────────────────

  describe "rule_fired" do
    let!(:match) do
      create(:signal_rule_match,
             site:             site,
             confidence:       0.82,
             workflow_status:  "unacknowledged",
             fired_at:         1.hour.ago,
             metadata:         {
               "distance_km"    => 45.3,
               "signal_type"    => "gps_jamming",
               "signal_source"  => "gpsjam",
               "actions_taken"  => [ "create_task" ]
             })
    end

    it "includes a rule_fired event" do
      ids = events.map { |e| e[:id] }
      expect(ids).to include("match_#{match.id}")
    end

    it "sets event_kind to rule_fired" do
      e = events.find { |ev| ev[:id] == "match_#{match.id}" }
      expect(e[:event_kind]).to eq("rule_fired")
    end

    it "includes confidence and workflow_status" do
      e = events.find { |ev| ev[:id] == "match_#{match.id}" }
      expect(e[:confidence]).to eq(0.82)
      expect(e[:workflow_status]).to eq("unacknowledged")
    end

    it "includes distance, actions in subtitle" do
      e = events.find { |ev| ev[:id] == "match_#{match.id}" }
      expect(e[:subtitle]).to include("82%")
      expect(e[:subtitle]).to include("45.3 km")
      expect(e[:subtitle]).to include("create task")
    end

    context "when fired_at is outside the lookback window" do
      let!(:old_match) do
        create(:signal_rule_match, site: site, fired_at: 30.days.ago)
      end

      it "excludes the old match" do
        ids = events.map { |e| e[:id] }
        expect(ids).not_to include("match_#{old_match.id}")
      end
    end
  end

  # ── task_created events ────────────────────────────────────────────────────

  describe "task_created" do
    let!(:task) do
      create(:task,
             site:            site,
             title:           "Inspect perimeter sensors",
             priority:        "high",
             workflow_status: "triaged",
             created_at:      3.hours.ago)
    end

    it "includes a task_created event" do
      ids = events.map { |e| e[:id] }
      expect(ids).to include("task_created_#{task.id}")
    end

    it "sets event_kind to task_created" do
      e = events.find { |ev| ev[:id] == "task_created_#{task.id}" }
      expect(e[:event_kind]).to eq("task_created")
    end

    it "includes task title in the event title" do
      e = events.find { |ev| ev[:id] == "task_created_#{task.id}" }
      expect(e[:title]).to include("Inspect perimeter sensors")
    end

    it "excludes tasks for other sites" do
      other_site = create(:site)
      other_task = create(:task, site: other_site, created_at: 1.hour.ago)
      ids = events.map { |e| e[:id] }
      expect(ids).not_to include("task_created_#{other_task.id}")
    end
  end

  # ── task_transitioned events ───────────────────────────────────────────────

  describe "task_transitioned" do
    let!(:task) { create(:task, site: site) }
    let!(:audit) do
      create(:audit_event,
             entity_type: "Task",
             entity_id:   task.id,
             event_type:  "task_transitioned",
             action:      "transition",
             actor:       "commander@test.mil",
             occurred_at: 1.hour.ago)
    end

    it "includes an audit event for the task" do
      ids = events.map { |e| e[:id] }
      expect(ids).to include("audit_#{audit.id}")
    end

    it "sets event_kind to task_transitioned" do
      e = events.find { |ev| ev[:id] == "audit_#{audit.id}" }
      expect(e[:event_kind]).to eq("task_transitioned")
    end

    it "records the actor" do
      e = events.find { |ev| ev[:id] == "audit_#{audit.id}" }
      expect(e[:actor]).to eq("commander@test.mil")
    end
  end

  # ── site_event events ──────────────────────────────────────────────────────

  describe "site_event" do
    let!(:site_audit) do
      create(:audit_event,
             entity_type: "Site",
             entity_id:   site.id,
             event_type:  "site_status_changed",
             action:      "toggle_status",
             actor:       "admin@test.mil",
             occurred_at: 2.hours.ago)
    end

    it "includes a site_event" do
      ids = events.map { |e| e[:id] }
      expect(ids).to include("audit_#{site_audit.id}")
    end

    it "sets event_kind to site_event" do
      e = events.find { |ev| ev[:id] == "audit_#{site_audit.id}" }
      expect(e[:event_kind]).to eq("site_event")
    end

    it "formats the title from action" do
      e = events.find { |ev| ev[:id] == "audit_#{site_audit.id}" }
      expect(e[:title]).to match(/Site toggle status/)
    end
  end

  # ── ordering and structure ────────────────────────────────────────────────

  describe "ordering" do
    let!(:old_event) do
      create(:external_signal, lat: 26.6, lng: 56.2, occurred_at: 5.days.ago)
    end
    let!(:new_event) do
      create(:external_signal, lat: 26.6, lng: 56.2, occurred_at: 1.hour.ago)
    end

    it "returns events newest-first" do
      times = events.map { |e| Time.parse(e[:occurred_at]) }
      expect(times).to eq(times.sort.reverse)
    end
  end

  describe "event structure" do
    let!(:signal) do
      create(:external_signal, lat: 26.6, lng: 56.2, occurred_at: 1.day.ago)
    end

    it "every event has the required keys" do
      events.each do |e|
        expect(e.keys).to include(:id, :event_kind, :occurred_at, :title, :actor, :meta)
      end
    end
  end

  # ── days parameter ────────────────────────────────────────────────────────

  describe "days parameter" do
    let!(:recent_signal) do
      create(:external_signal, lat: 26.6, lng: 56.2, occurred_at: 2.days.ago)
    end
    let!(:old_signal) do
      create(:external_signal, lat: 26.6, lng: 56.2, occurred_at: 5.days.ago)
    end

    it "respects a 3-day lookback" do
      result = described_class.call(site: site, days: 3)
      ids    = result.map { |e| e[:id] }
      expect(ids).to     include("sig_#{recent_signal.id}")
      expect(ids).not_to include("sig_#{old_signal.id}")
    end

    it "clamps days below 1 to 1" do
      expect { described_class.call(site: site, days: 0) }.not_to raise_error
    end

    it "clamps days above 90 to 90" do
      expect { described_class.call(site: site, days: 999) }.not_to raise_error
    end
  end
end
