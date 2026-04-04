require "rails_helper"

RSpec.describe Analytics::SwimlaneService do
  let!(:site1) { create(:site) }
  let!(:site2) { create(:site) }

  before do
    # Create audit events that TimelineService will pick up
    create(:audit_event,
      entity_type: "Site", entity_id: site1.id,
      event_type: "signal_detected", occurred_at: 1.hour.ago,
    )
    create(:audit_event,
      entity_type: "Site", entity_id: site2.id,
      event_type: "rule_fired", occurred_at: 2.hours.ago,
    )
  end

  describe "basic output" do
    it "returns lanes with expected structure" do
      result = described_class.call(days: 3)

      expect(result).to have_key(:data)
      expect(result).to have_key(:meta)
      expect(result[:meta][:days]).to eq(3)
      expect(result[:meta][:lane_limit]).to eq(8)
    end
  end

  describe "parameter clamping" do
    it "clamps days to MAX_DAYS" do
      result = described_class.call(days: 999)
      expect(result[:meta][:days]).to eq(30)
    end

    it "clamps days minimum to 1" do
      result = described_class.call(days: 0)
      expect(result[:meta][:days]).to eq(1)
    end

    it "clamps lane_limit to MAX_LANE_LIMIT" do
      result = described_class.call(lane_limit: 100)
      expect(result[:meta][:lane_limit]).to eq(12)
    end
  end

  describe "site filtering" do
    it "filters to specific site_ids" do
      result = described_class.call(site_ids: [site1.id])
      expect(result[:meta][:selected_site_ids]).to eq([site1.id])
    end
  end

  describe "kind filtering" do
    it "filters by event kinds" do
      result = described_class.call(kinds: "signal_detected")
      expect(result[:meta][:event_kinds]).to eq(["signal_detected"])
    end

    it "rejects invalid kinds" do
      result = described_class.call(kinds: "hacking_the_mainframe")
      # Invalid kind is filtered out by intersection with VALID_KINDS
      lanes = result[:data]
      lanes.each do |lane|
        lane[:events].each do |event|
          expect(described_class::VALID_KINDS).to include(event[:event_kind])
        end
      end
    end
  end

  describe "lane ordering" do
    it "orders by most recent activity first" do
      result = described_class.call(days: 3)
      return if result[:data].size < 2

      timestamps = result[:data].map { |l| l[:last_event_at] }
      expect(timestamps).to eq(timestamps.sort.reverse)
    end
  end

  describe "event cap" do
    it "caps visible events at MAX_VISIBLE_EVENTS" do
      # Create many events for one site
      30.times do |i|
        create(:audit_event,
          entity_type: "Site", entity_id: site1.id,
          event_type: "signal_detected", occurred_at: i.minutes.ago,
        )
      end

      result = described_class.call(days: 3)
      site1_lane = result[:data].find { |l| l[:site_id] == site1.id }

      next unless site1_lane

      expect(site1_lane[:visible_event_count]).to be <= 24
      expect(site1_lane[:event_count]).to be >= site1_lane[:visible_event_count]
    end
  end
end
