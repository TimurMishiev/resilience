require "rails_helper"

RSpec.describe Feeds::AcledIngestionService, type: :service do
  # Tests call the private #ingest_event method directly to avoid requiring
  # live ACLED API credentials and network access.
  # Theater-box filtering, deduplication, and magnitude mapping are all tested.

  let(:service) { described_class.new }

  # Minimal ACLED event record (mirrors the real API response shape)
  let(:raw_event) do
    {
      "event_id_cnty" => "SYR12345",
      "event_date"    => "2026-03-18",
      "event_type"    => "Explosions/Remote violence",
      "sub_event_type" => "Air/drone strike",
      "actor1"        => "Military Forces of Syria",
      "actor2"        => "",
      "country"       => "Syria",
      "latitude"      => "35.5",
      "longitude"     => "37.2",
      "fatalities"    => "3",
      "notes"         => "An airstrike targeted a residential area."
    }
  end

  describe "#ingest_event (signal creation)" do
    it "creates an ExternalSignal with signal_type conflict_event" do
      expect {
        service.send(:ingest_event, raw_event, 35.5, 37.2)
      }.to change(ExternalSignal, :count).by(1)

      signal = ExternalSignal.last
      expect(signal.signal_type).to eq("conflict_event")
      expect(signal.source).to eq("acled")
    end

    it "uses event_id_cnty as the external_id" do
      service.send(:ingest_event, raw_event, 35.5, 37.2)
      expect(ExternalSignal.last.external_id).to eq("SYR12345")
    end

    it "stores fatalities as magnitude" do
      service.send(:ingest_event, raw_event, 35.5, 37.2)
      expect(ExternalSignal.last.magnitude.to_f).to eq(3.0)
    end

    it "sets magnitude to nil when fatalities is zero" do
      zero_event = raw_event.merge("fatalities" => "0")
      service.send(:ingest_event, zero_event, 35.5, 37.2)
      expect(ExternalSignal.last.magnitude).to be_nil
    end

    it "stores raw payload with event_type, actor1, country, notes" do
      service.send(:ingest_event, raw_event, 35.5, 37.2)
      payload = ExternalSignal.last.raw_payload
      expect(payload["event_type"]).to eq("Explosions/Remote violence")
      expect(payload["actor1"]).to eq("Military Forces of Syria")
      expect(payload["country"]).to eq("Syria")
      expect(payload["fatalities"]).to eq(3)
    end

    it "truncates notes to 500 characters" do
      long_event = raw_event.merge("notes" => "x" * 600)
      service.send(:ingest_event, long_event, 35.5, 37.2)
      expect(ExternalSignal.last.raw_payload["notes"].length).to be <= 500
    end

    it "deduplicates — second call with same event_id_cnty does not create a new record" do
      service.send(:ingest_event, raw_event, 35.5, 37.2)
      expect {
        service.send(:ingest_event, raw_event, 35.5, 37.2)
      }.not_to change(ExternalSignal, :count)
    end

    it "falls back to a coordinate-based external_id when event_id_cnty is absent" do
      no_id_event = raw_event.except("event_id_cnty")
      service.send(:ingest_event, no_id_event, 35.5, 37.2)
      signal = ExternalSignal.last
      expect(signal).to be_present
      expect(signal.external_id).to include("2026-03-18")
    end

    it "parses event_date into a noon UTC timestamp" do
      service.send(:ingest_event, raw_event, 35.5, 37.2)
      expect(ExternalSignal.last.occurred_at.hour).to eq(12)
      expect(ExternalSignal.last.occurred_at.utc?).to be true
    end

    it "returns nil silently on error without raising" do
      allow(Signals::IngestService).to receive(:call).and_raise(RuntimeError, "network error")
      expect { service.send(:ingest_event, raw_event, 35.5, 37.2) }.not_to raise_error
    end
  end

  describe "#query_boxes" do
    it "builds scope boxes from active site coordinates" do
      create(:site, latitude: 35.5, longitude: 37.2, geofence_radius_km: 50)

      boxes = service.send(:query_boxes)
      expect(boxes).not_to be_empty
      expect(service.send(:point_in_box?, boxes.first, 35.5, 37.2)).to be true
    end

    it "includes AO polygon bounds in the live footprint" do
      area = create(
        :area_of_operation,
        geometry: {
          "type" => "Polygon",
          "coordinates" => [[[30.0, 10.0], [40.0, 10.0], [40.0, 15.0], [30.0, 15.0], [30.0, 10.0]]],
        },
      )
      create(:site, latitude: 35.5, longitude: 37.2, area_of_operation: area)

      boxes = service.send(:query_boxes)
      expect(boxes.any? { |box| service.send(:point_in_box?, box, 12.0, 35.0) }).to be true
    end

    it "ignores inactive sites when building the footprint" do
      create(:site, :inactive, latitude: 35.5, longitude: 37.2)

      expect(service.send(:query_boxes)).to eq([])
    end

    it "includes an AO polygon with no active site in the footprint" do
      create(
        :area_of_operation,
        geometry: {
          "type" => "Polygon",
          "coordinates" => [[[20.0, 10.0], [25.0, 10.0], [25.0, 15.0], [20.0, 15.0], [20.0, 10.0]]],
        },
      )

      boxes = service.send(:query_boxes)
      expect(boxes).not_to be_empty
      expect(boxes.any? { |box| service.send(:point_in_box?, box, 12.0, 22.0) }).to be true
    end

    it "clamps polar site boxes to valid lat/lng bounds" do
      site = create(:site, latitude: 89.6, longitude: 179.2, geofence_radius_km: 10)

      box = service.send(:site_scope_box, site)

      expect(box[:latmin]).to be >= -90.0
      expect(box[:latmax]).to eq(90.0)
      expect(box[:lonmin]).to be >= -180.0
      expect(box[:lonmax]).to eq(180.0)
      expect(service.send(:point_in_box?, box, 89.6, 179.2)).to be true
    end
  end

  describe "#call with missing credentials" do
    # In CI / test environment neither ACLED_API_KEY nor ACLED_EMAIL is set,
    # so the credential guard fires and the service short-circuits gracefully.
    it "returns success with 0 ingested when credentials are absent" do
      # Ensure neither var is set for this test
      saved_key   = ENV.delete("ACLED_API_KEY")
      saved_email = ENV.delete("ACLED_EMAIL")

      begin
        result = described_class.call
        expect(result.success).to be true
        expect(result.payload[:ingested]).to eq(0)
      ensure
        ENV["ACLED_API_KEY"]  = saved_key   if saved_key
        ENV["ACLED_EMAIL"]    = saved_email if saved_email
      end
    end

    it "returns success with 0 ingested when only ACLED_EMAIL is absent" do
      saved_email = ENV.delete("ACLED_EMAIL")
      saved_key   = ENV["ACLED_API_KEY"]
      ENV["ACLED_API_KEY"] = "test-key-placeholder"

      begin
        result = described_class.call
        expect(result.success).to be true
        expect(result.payload[:ingested]).to eq(0)
      ensure
        saved_key ? ENV["ACLED_API_KEY"] = saved_key : ENV.delete("ACLED_API_KEY")
        ENV["ACLED_EMAIL"] = saved_email if saved_email
      end
    end
  end

  describe "#call with pagination and footprint filtering" do
    around do |example|
      saved_key = ENV["ACLED_API_KEY"]
      saved_email = ENV["ACLED_EMAIL"]
      ENV["ACLED_API_KEY"] = "test-key"
      ENV["ACLED_EMAIL"] = "test@example.com"
      example.run
    ensure
      saved_key ? ENV["ACLED_API_KEY"] = saved_key : ENV.delete("ACLED_API_KEY")
      saved_email ? ENV["ACLED_EMAIL"] = saved_email : ENV.delete("ACLED_EMAIL")
    end

    before do
      stub_const("#{described_class}::PER_PAGE", 2)
    end

    it "paginates through ACLED pages for the current footprint" do
      create(:site, latitude: 35.5, longitude: 37.2)

      http = instance_double(Net::HTTP)
      page_1 = instance_double(Net::HTTPResponse, code: "200", body: {
        "data" => [
          raw_event.merge("event_id_cnty" => "SYR-1"),
          raw_event.merge("event_id_cnty" => "SYR-2", "latitude" => "35.6", "longitude" => "37.3"),
        ],
      }.to_json)
      page_2 = instance_double(Net::HTTPResponse, code: "200", body: {
        "data" => [
          raw_event.merge("event_id_cnty" => "SYR-3", "latitude" => "35.7", "longitude" => "37.4"),
        ],
      }.to_json)

      allow(service).to receive(:ssl_http).and_return(http)
      allow(http).to receive(:get).and_return(page_1, page_2)

      result = nil
      expect {
        result = service.call
      }.to change(ExternalSignal, :count).by(3)
      expect(http).to have_received(:get).twice
      expect(http).to have_received(:get).with(include("page=1"))
      expect(http).to have_received(:get).with(include("page=2"))
      expect(http).to have_received(:get).with(include("latitude_where=BETWEEN")).at_least(:once)
      expect(http).to have_received(:get).with(include("longitude_where=BETWEEN")).at_least(:once)
      expect(result.payload[:feed_health]).to include(
        feed: "acled",
        status: "ok",
        fetched_count: 3,
        ingested_count: 3,
        page_count: 2,
        query_box_count: 1,
      )
    end

    it "filters events to the live site/AO footprint instead of ingesting every returned event" do
      create(:site, latitude: 35.5, longitude: 37.2)

      http = instance_double(Net::HTTP)
      response = instance_double(Net::HTTPResponse, code: "200", body: {
        "data" => [
          raw_event.merge("event_id_cnty" => "SYR-1"),
          raw_event.merge("event_id_cnty" => "FAR-1", "latitude" => "-15.0", "longitude" => "-65.0"),
        ],
      }.to_json)
      empty_response = instance_double(Net::HTTPResponse, code: "200", body: {
        "data" => [],
      }.to_json)

      allow(service).to receive(:ssl_http).and_return(http)
      allow(http).to receive(:get).and_return(response, empty_response)

      expect { service.call }.to change(ExternalSignal, :count).by(1)
      expect(ExternalSignal.last.external_id).to eq("SYR-1")
    end

    it "deduplicates overlapping footprint hits before ingesting" do
      create(:site, latitude: 35.5, longitude: 37.2)
      area = create(
        :area_of_operation,
        geometry: {
          "type" => "Polygon",
          "coordinates" => [[[36.5, 34.5], [38.5, 34.5], [38.5, 36.5], [36.5, 36.5], [36.5, 34.5]]],
        },
      )
      create(:site, latitude: 35.6, longitude: 37.3, area_of_operation: area)

      http = instance_double(Net::HTTP)
      response = instance_double(Net::HTTPResponse, code: "200", body: {
        "data" => [raw_event.merge("event_id_cnty" => "SYR-DEDUP")],
      }.to_json)

      allow(service).to receive(:ssl_http).and_return(http)
      allow(http).to receive(:get).and_return(response, response)

      expect(service).to receive(:ingest_event).once.and_call_original
      service.call
    end
  end
end
