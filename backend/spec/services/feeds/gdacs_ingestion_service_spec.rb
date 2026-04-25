require "rails_helper"

RSpec.describe Feeds::GdacsIngestionService, type: :service do
  # Tests call the private #ingest_feature and #parse_timestamp methods directly
  # to avoid requiring live GDACS API access. The GeoJSON feature structure
  # mirrors the real API response.

  let(:service) { described_class.new }

  # Minimal GeoJSON feature (earthquake in Middle East theater)
  let(:raw_feature) do
    {
      "type"     => "Feature",
      "geometry" => { "type" => "Point", "coordinates" => [44.5, 33.2] },
      "properties" => {
        "eventtype"        => "EQ",
        "eventid"          => 1530181,
        "episodeid"        => 1694199,
        "name"             => "Earthquake in Iraq",
        "country"          => "Iraq",
        "iso3"             => "IRQ",
        "alertlevel"       => "Orange",
        "alertscore"       => 2,
        "episodealertscore" => 1.75,
        "iscurrent"        => "true",
        "fromdate"         => "2026-03-18T14:30:00",
        "todate"           => "2026-03-18T14:30:00",
        "severitydata"     => {
          "severity"        => 5.8,
          "severitytext"    => "Magnitude 5.8M, Depth:15km",
          "severityunit"    => "M",
          "episodealertscore" => 1.75
        }
      }
    }
  end

  # Flood event with zero alert score
  let(:flood_feature) do
    {
      "type"     => "Feature",
      "geometry" => { "type" => "Point", "coordinates" => [37.0, 10.5] },
      "properties" => {
        "eventtype"        => "FL",
        "eventid"          => 2000001,
        "episodeid"        => 3000001,
        "name"             => "Flood in Tunisia",
        "country"          => "Tunisia",
        "iso3"             => "TUN",
        "alertlevel"       => "Green",
        "alertscore"       => 1,
        "episodealertscore" => 0.0,
        "iscurrent"        => "true",
        "fromdate"         => "2026-03-17T08:00:00",
        "todate"           => "2026-03-20T08:00:00",
        "severitydata"     => {
          "severity"    => 0.0,
          "severitytext" => "Magnitude 0",
          "severityunit" => "",
          "episodealertscore" => 0.0
        }
      }
    }
  end

  describe "#ingest_feature (signal creation)" do
    it "creates an ExternalSignal with signal_type disaster_alert" do
      expect {
        service.send(:ingest_feature, raw_feature)
      }.to change(ExternalSignal, :count).by(1)

      signal = ExternalSignal.last
      expect(signal.signal_type).to eq("disaster_alert")
      expect(signal.source).to eq("gdacs")
    end

    it "builds external_id from eventtype + eventid + episodeid" do
      service.send(:ingest_feature, raw_feature)
      expect(ExternalSignal.last.external_id).to eq("gdacs_EQ_1530181_1694199")
    end

    it "stores lat/lng from GeoJSON coordinates (note: [lng, lat] order)" do
      service.send(:ingest_feature, raw_feature)
      signal = ExternalSignal.last
      expect(signal.lat.to_f).to eq(33.2)
      expect(signal.lng.to_f).to eq(44.5)
    end

    it "stores episodealertscore as magnitude" do
      service.send(:ingest_feature, raw_feature)
      expect(ExternalSignal.last.magnitude.to_f).to eq(1.75)
    end

    it "sets magnitude to nil when episodealertscore is zero" do
      service.send(:ingest_feature, flood_feature)
      expect(ExternalSignal.last.magnitude).to be_nil
    end

    it "falls back to alertscore when episodealertscore is absent" do
      no_episode_score = raw_feature.deep_dup
      no_episode_score["properties"].delete("episodealertscore")
      no_episode_score["properties"]["severitydata"].delete("episodealertscore")
      no_episode_score["properties"]["alertscore"] = 2

      service.send(:ingest_feature, no_episode_score)
      expect(ExternalSignal.last.magnitude.to_f).to eq(2.0)
    end

    it "stores raw payload with event_type_name, country, alert_level, severity_text" do
      service.send(:ingest_feature, raw_feature)
      payload = ExternalSignal.last.raw_payload
      expect(payload["event_type_name"]).to eq("Earthquake")
      expect(payload["country"]).to eq("Iraq")
      expect(payload["alert_level"]).to eq("Orange")
      expect(payload["severity_text"]).to eq("Magnitude 5.8M, Depth:15km")
    end

    it "deduplicates — second call with same event IDs does not create a new record" do
      service.send(:ingest_feature, raw_feature)
      expect {
        service.send(:ingest_feature, raw_feature)
      }.not_to change(ExternalSignal, :count)
    end

    it "returns nil when eventid is absent" do
      bad = raw_feature.deep_dup
      bad["properties"].delete("eventid")
      expect(service.send(:ingest_feature, bad)).to be_nil
      expect(ExternalSignal.count).to eq(0)
    end

    it "returns nil for zero-coordinate features (unmapped events)" do
      zero = raw_feature.deep_dup
      zero["geometry"]["coordinates"] = [0.0, 0.0]
      expect(service.send(:ingest_feature, zero)).to be_nil
      expect(ExternalSignal.count).to eq(0)
    end

    it "returns nil silently on ingest error without raising" do
      allow(Signals::IngestService).to receive(:call).and_raise(RuntimeError, "db error")
      expect { service.send(:ingest_feature, raw_feature) }.not_to raise_error
    end
  end

  describe "#parse_timestamp" do
    it "parses GDACS ISO 8601 timestamp as UTC" do
      ts = service.send(:parse_timestamp, "2026-03-18T14:30:00")
      expect(ts).to be_within(1.second).of(Time.utc(2026, 3, 18, 14, 30, 0))
      expect(ts.utc?).to be true
    end

    it "returns current time when timestamp is blank" do
      expect(service.send(:parse_timestamp, nil)).to be_within(5.seconds).of(Time.current)
      expect(service.send(:parse_timestamp, "")).to  be_within(5.seconds).of(Time.current)
    end

    it "returns current time when timestamp is malformed" do
      expect(service.send(:parse_timestamp, "not-a-date")).to be_within(5.seconds).of(Time.current)
    end
  end

  describe "#call (HTTP error handling)" do
    # Stub at the PayloadGuards boundary (Tranche 3A, 2026-04-25):
    # all feed services now route HTTP through
    # Feeds::PayloadGuards.safe_get for body-size + UTF-8 guards, so
    # specs no longer need to fake Net::HTTPResponse's streaming
    # interface — they just return a SafeResponse with the desired
    # code + body.
    def fake_response(code, body)
      resp = Feeds::PayloadGuards::SafeResponse.new(
        code:    code.to_s,
        body:    body,
        headers: {},
      )
      allow(Feeds::PayloadGuards).to receive(:safe_get).and_return(resp)
    end

    it "returns success with 0 ingested on non-200 response" do
      fake_response(503, "")
      result = service.call
      expect(result.success).to be true
      expect(result.payload[:ingested]).to eq(0)
    end

    it "returns success with 0 ingested on JSON parse error" do
      fake_response(200, "not json {{")
      result = service.call
      expect(result.success).to be true
      expect(result.payload[:ingested]).to eq(0)
    end

    it "ingests features from a valid GeoJSON response" do
      body = {
        "type"     => "FeatureCollection",
        "features" => [ raw_feature ]
      }.to_json

      fake_response(200, body)
      result = service.call
      expect(result.success).to be true
      expect(result.payload[:ingested]).to eq(1)
    end
  end
end
