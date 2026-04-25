require "rails_helper"

RSpec.describe Feeds::PayloadGuards do
  describe ".safe_get" do
    # Builds a fake Net::HTTP that yields a fake response whose
    # read_body yields the given chunks. Mirrors the streaming-
    # block contract so PayloadGuards' guards exercise the real
    # branch logic instead of a stub.
    def fake_http(chunks: [], code: "200", content_length: nil)
      fake_response = double("Net::HTTPResponse")
      allow(fake_response).to receive(:code).and_return(code)
      allow(fake_response).to receive(:to_hash).and_return({})
      allow(fake_response).to receive(:[]) do |header|
        case header
        when "Content-Length" then content_length&.to_s
        else nil
        end
      end
      allow(fake_response).to receive(:read_body) do |&blk|
        chunks.each { |chunk| blk.call(chunk) }
      end

      fake_http_obj = double("Net::HTTP")
      allow(fake_http_obj).to receive(:request) do |_request, &blk|
        blk.call(fake_response)
      end
      fake_http_obj
    end

    it "returns a SafeResponse with code + body for a normal small payload" do
      body = '{"hello":"world"}'
      result = described_class.safe_get(fake_http(chunks: [ body ]), "/")

      expect(result).to be_a(described_class::SafeResponse)
      expect(result.code).to eq("200")
      expect(result.body).to eq(body)
    end

    it "concatenates multi-chunk streamed bodies correctly" do
      result = described_class.safe_get(
        fake_http(chunks: [ "{\"a\":", "1,\"b\":", "2}" ]),
        "/",
      )

      expect(result.body).to eq('{"a":1,"b":2}')
    end

    it "raises OversizedPayloadError when Content-Length advertises a body larger than max_bytes" do
      expect {
        described_class.safe_get(
          fake_http(chunks: [ "x" ], content_length: 100_000_000),
          "/",
          max_bytes: 1_000,
        )
      }.to raise_error(
        described_class::OversizedPayloadError,
        /Content-Length 100000000 exceeds max 1000 bytes/,
      )
    end

    it "raises OversizedPayloadError when streamed body exceeds max_bytes (Content-Length absent)" do
      # Hostile upstream: Content-Length absent, body actually
      # exceeds the cap once we start streaming.
      expect {
        described_class.safe_get(
          fake_http(chunks: [ "a" * 600, "b" * 600 ]),
          "/",
          max_bytes: 1_000,
        )
      }.to raise_error(
        described_class::OversizedPayloadError,
        /streamed body exceeded max 1000 bytes/,
      )
    end

    it "passes through Content-Length within the cap without raising" do
      body = "x" * 1_000
      result = described_class.safe_get(
        fake_http(chunks: [ body ], content_length: 1_000),
        "/",
        max_bytes: 1_000,
      )
      expect(result.body.bytesize).to eq(1_000)
    end

    it "forwards request headers to the underlying HTTP request" do
      sent_request = nil
      fake_response = double("Net::HTTPResponse")
      allow(fake_response).to receive(:code).and_return("200")
      allow(fake_response).to receive(:to_hash).and_return({})
      allow(fake_response).to receive(:[]).and_return(nil)
      allow(fake_response).to receive(:read_body)

      fake_http_obj = double("Net::HTTP")
      allow(fake_http_obj).to receive(:request) do |req, &blk|
        sent_request = req
        blk.call(fake_response)
      end

      described_class.safe_get(
        fake_http_obj,
        "/path",
        headers: { "Authorization" => "Bearer xyz", "Accept-Encoding" => "gzip" },
      )

      expect(sent_request["Authorization"]).to eq("Bearer xyz")
      expect(sent_request["Accept-Encoding"]).to eq("gzip")
    end

    it "forwards basic_auth credentials to the underlying HTTP request" do
      # Pins the OpenSky authenticated path: open_sky_ingestion_service
      # passes basic_auth: [username, password] to safe_get when
      # OPENSKY_USERNAME is set. A regression that silently drops the
      # credentials would leave the production deploy falling back to
      # OpenSky's anonymous quota tier without a failing test.
      sent_request = nil
      fake_response = double("Net::HTTPResponse")
      allow(fake_response).to receive(:code).and_return("200")
      allow(fake_response).to receive(:to_hash).and_return({})
      allow(fake_response).to receive(:[]).and_return(nil)
      allow(fake_response).to receive(:read_body)

      fake_http_obj = double("Net::HTTP")
      allow(fake_http_obj).to receive(:request) do |req, &blk|
        sent_request = req
        blk.call(fake_response)
      end

      described_class.safe_get(
        fake_http_obj,
        "/path",
        basic_auth: [ "alice", "s3cret" ],
      )

      # Net::HTTP::Get#basic_auth sets Authorization to
      # "Basic " + base64(user:pass). Asserting on the encoded value
      # proves the credentials reached the wire, not just that
      # request.basic_auth was called.
      expected = "Basic " + Base64.strict_encode64("alice:s3cret")
      expect(sent_request["Authorization"]).to eq(expected)
    end

    it "does not set Authorization when basic_auth is omitted (back-compat for unauthenticated feeds)" do
      sent_request = nil
      fake_response = double("Net::HTTPResponse")
      allow(fake_response).to receive(:code).and_return("200")
      allow(fake_response).to receive(:to_hash).and_return({})
      allow(fake_response).to receive(:[]).and_return(nil)
      allow(fake_response).to receive(:read_body)

      fake_http_obj = double("Net::HTTP")
      allow(fake_http_obj).to receive(:request) do |req, &blk|
        sent_request = req
        blk.call(fake_response)
      end

      described_class.safe_get(fake_http_obj, "/path")

      expect(sent_request["Authorization"]).to be_nil
    end
  end

  describe ".safe_parse_json" do
    it "parses a normal JSON payload" do
      result = described_class.safe_parse_json('{"a":1,"b":[2,3]}')
      expect(result).to eq("a" => 1, "b" => [ 2, 3 ])
    end

    it "raises JSON::NestingError when nesting exceeds max_nesting" do
      # Build {"a": {"a": {"a": ... }}} 50 levels deep
      deep = (1..50).to_a.reverse.inject('"x"') { |inner, _| "{\"a\":#{inner}}" }

      expect {
        described_class.safe_parse_json(deep, max_nesting: 32)
      }.to raise_error(JSON::NestingError)
    end

    it "accepts payloads at exactly max_nesting depth" do
      # 5 levels deep: {"a":{"a":{"a":{"a":{"a":"x"}}}}}
      shallow = (1..5).to_a.reverse.inject('"x"') { |inner, _| "{\"a\":#{inner}}" }

      expect {
        described_class.safe_parse_json(shallow, max_nesting: 32)
      }.not_to raise_error
    end

    it "raises PayloadEncodingError on invalid UTF-8 bytes" do
      # 0xFF on its own is not valid UTF-8
      bad_bytes = "\xFF\xFE invalid".force_encoding(Encoding::ASCII_8BIT)

      expect {
        described_class.safe_parse_json(bad_bytes)
      }.to raise_error(
        described_class::PayloadEncodingError,
        /invalid UTF-8 bytes/,
      )
    end

    it "strips a leading BOM and parses the rest" do
      bom_prefixed = "\u{FEFF}".dup.force_encoding(Encoding::UTF_8) + '{"a":1}'
      result = described_class.safe_parse_json(bom_prefixed)
      expect(result).to eq("a" => 1)
    end

    it "force-encodes binary-encoded body to UTF-8 before parsing" do
      # safe_get returns ASCII-8BIT body; safe_parse_json must
      # transcode to UTF-8 transparently.
      body = '{"a":1}'.dup.force_encoding(Encoding::ASCII_8BIT)
      result = described_class.safe_parse_json(body)
      expect(result).to eq("a" => 1)
    end
  end

  describe ".safe_inflate" do
    # Helper builds a real gzip-compressed payload of the requested
    # decompressed size. Uses zeros so the compressed output is
    # tiny — the gzip-bomb attack vector exactly.
    def gzip_of(decompressed_body)
      io = StringIO.new
      gz = Zlib::GzipWriter.new(io)
      gz.write(decompressed_body)
      gz.close
      io.string
    end

    it "returns the inflated body when it stays under max_bytes" do
      payload = "lat,lng\n1.0,2.0\n3.0,4.0"
      compressed = gzip_of(payload)

      result = described_class.safe_inflate(compressed, max_bytes: 1_000)

      expect(result).to eq(payload)
    end

    it "raises OversizedPayloadError when the inflated body exceeds max_bytes — gzip-bomb defence" do
      # Real gzip of 1 MB of zeros compresses to ~1 KB. A 25 MB
      # compressed cap (the safe_get default) would happily admit a
      # payload that decompresses to hundreds of MB. This spec proves
      # safe_inflate catches that — it is the regression guard for
      # the GPSJam P1 finding (Codex /gate, 2026-04-25).
      bomb_decompressed = "0" * (1 * 1024 * 1024) # 1 MB of zeros
      compressed = gzip_of(bomb_decompressed)
      expect(compressed.bytesize).to be < 100_000 # << 1 MB compressed

      expect {
        described_class.safe_inflate(compressed, max_bytes: 100_000)
      }.to raise_error(
        described_class::OversizedPayloadError,
        /inflated body exceeded max 100000 bytes \(gzip bomb\?\)/,
      )
    end

    it "closes the GzipReader even when the cap is hit mid-stream" do
      bomb = gzip_of("x" * 200_000)

      reader_double = nil
      allow(Zlib::GzipReader).to receive(:new).and_wrap_original do |original, *args|
        reader_double = original.call(*args)
        reader_double
      end

      expect {
        described_class.safe_inflate(bomb, max_bytes: 1_000)
      }.to raise_error(described_class::OversizedPayloadError)

      # Closed cleanly so the underlying StringIO + Zlib state is
      # not leaked on the hot path.
      expect(reader_double).to be_closed
    end
  end

  describe ".normalise_utf8" do
    it "exposes the encoding check separately for CSV-parsing feeds (FIRMS)" do
      good = "lat,lng\n1.0,2.0".force_encoding(Encoding::ASCII_8BIT)
      expect(described_class.normalise_utf8(good)).to eq("lat,lng\n1.0,2.0")

      bad = "\xFF invalid".force_encoding(Encoding::ASCII_8BIT)
      expect { described_class.normalise_utf8(bad) }.to raise_error(
        described_class::PayloadEncodingError,
      )
    end
  end

  describe "constants" do
    it "documents conservative defaults" do
      # Pin the limits so a future change has to come with a
      # deliberate update to ADR-007 / ADR-009.
      expect(described_class::DEFAULT_MAX_BYTES).to eq(25 * 1024 * 1024)
      expect(described_class::DEFAULT_MAX_JSON_NESTING).to eq(32)
    end
  end
end
