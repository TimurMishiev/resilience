require "net/http"
require "json"
require "stringio"
require "zlib"

module Feeds
  # Hostile-input guards for feed ingestion (Tranche 3A,
  # 2026-04-25 — closes ADR-007's "no adversarial-input posture on
  # feeds" gap and the matching ADR-009 item 7).
  #
  # The threat model: a compromised upstream (or a misconfigured
  # one) returns a payload designed to OOM, stack-overflow, or
  # otherwise crash the ingestion worker. Concrete attacks the
  # guards close:
  #
  #   1. Oversized body (1 GB JSON payload) → kill the worker before
  #      it tries to parse. Both Content-Length pre-check and
  #      streamed-bytes accumulation, so a hostile upstream that
  #      lies about Content-Length is still bounded.
  #   2. Pathologically deep JSON nesting ({a:{a:{a:...}}} 10k deep)
  #      → JSON.parse with explicit max_nesting raises
  #      JSON::NestingError before stack overflow. Ruby's default
  #      max_nesting is 100, but we set 32 because no legitimate
  #      feed payload nests more than ~5 levels (GeoJSON
  #      FeatureCollection > features > geometry > coordinates >
  #      pair).
  #   3. Invalid UTF-8 / mixed-encoding payloads → force_encoding +
  #      valid_encoding? check raises PayloadEncodingError before
  #      the parser tries to interpret junk bytes. Strips a leading
  #      BOM so a well-meaning-but-non-spec upstream still works.
  #
  # Limits are conservative — large enough to accommodate the
  # heaviest legitimate feed payload (~10 MB OpenSky ADS-B globally;
  # ~2-3 MB USGS 24h lookback; ~2 MB ACLED page) with 2.5× headroom
  # for unexpected upstream growth, small enough that any payload
  # exceeding them is almost certainly adversarial or a
  # misconfigured upstream that should not silently land in the
  # signal table.
  module PayloadGuards
    # 25 MB body cap. Matches "largest legitimate feed payload"
    # (~10 MB OpenSky) with 2.5× headroom.
    DEFAULT_MAX_BYTES = 25 * 1024 * 1024

    # 32-deep JSON nesting cap. The deepest legitimate feed
    # payload is ~5 levels.
    DEFAULT_MAX_JSON_NESTING = 32

    OversizedPayloadError = Class.new(StandardError)
    PayloadEncodingError  = Class.new(StandardError)

    # Mimics the relevant Net::HTTPResponse surface so call sites
    # don't have to learn a new interface — they read .code, .body,
    # and headers via [] the same way they did before. headers is
    # the hash returned by Net::HTTPResponse#to_hash (lowercased
    # keys, array-valued); the [] accessor matches Net::HTTPResponse's
    # case-insensitive single-value behaviour.
    SafeResponse = Struct.new(:code, :body, :headers, keyword_init: true) do
      def [](header_name)
        return nil if headers.nil?
        values = headers[header_name.to_s.downcase] || headers[header_name.to_s]
        Array(values).first
      end
    end

    module_function

    # Performs an HTTP GET with body-size cap. Streams the response
    # and accumulates bytes; raises OversizedPayloadError if the
    # Content-Length advertises a body larger than max_bytes OR if
    # the streamed body actually exceeds max_bytes (defends against
    # a hostile upstream that lies about Content-Length).
    #
    # Returns SafeResponse with .code (string status) and .body
    # (binary-encoding String accumulated from the streamed chunks
    # — call sites that need text should pass to safe_parse_json or
    # force_encoding themselves).
    def safe_get(http, request_uri, headers: {}, basic_auth: nil, max_bytes: DEFAULT_MAX_BYTES)
      request = Net::HTTP::Get.new(request_uri)
      headers.each { |k, v| request[k] = v }
      request.basic_auth(*basic_auth) if basic_auth

      body = String.new(encoding: Encoding::ASCII_8BIT)
      code = nil
      response_headers = {}

      http.request(request) do |res|
        code = res.code
        response_headers = res.to_hash

        # Pre-flight: trust-but-verify the Content-Length. A hostile
        # upstream can lie or omit it, so the streamed-bytes check
        # below is the real ceiling — but bailing early on a clearly
        # oversized advertised payload saves wasted bandwidth.
        if (cl = res["Content-Length"]) && cl.to_i > max_bytes
          raise OversizedPayloadError,
                "Feed payload Content-Length #{cl} exceeds max #{max_bytes} bytes"
        end

        # Stream the body chunk-by-chunk. read_body without a block
        # would buffer the entire body before returning — for a
        # hostile multi-GB payload that would already be too late.
        res.read_body do |chunk|
          body << chunk
          if body.bytesize > max_bytes
            raise OversizedPayloadError,
                  "Feed payload streamed body exceeded max #{max_bytes} bytes"
          end
        end
      end

      SafeResponse.new(code: code, body: body, headers: response_headers)
    end

    # Parses JSON with strict guards: max_nesting enforced, UTF-8
    # validated, BOM stripped. Wraps JSON::NestingError (raised by
    # the parser itself) as-is so call sites can rescue it via the
    # JSON namespace they already know.
    def safe_parse_json(body, max_nesting: DEFAULT_MAX_JSON_NESTING)
      JSON.parse(normalise_utf8(body), max_nesting: max_nesting)
    end

    # Decompresses a gzip body with a decompressed-byte ceiling.
    # Without this, a hostile upstream can stay under safe_get's
    # compressed-body cap (25 MB) and then expand to hundreds of
    # MB or more during inflate — defeating the OOM protection.
    # Reads in 64 KB chunks and raises OversizedPayloadError if the
    # cumulative decompressed size exceeds max_bytes.
    #
    # Used by GPSJam (the only feed that requests gzip transport
    # today). Returns a binary-encoded String suitable for downstream
    # encoding normalisation.
    INFLATE_CHUNK_BYTES = 64 * 1024

    def safe_inflate(compressed_body, max_bytes: DEFAULT_MAX_BYTES)
      reader = Zlib::GzipReader.new(StringIO.new(compressed_body))
      result = String.new(encoding: Encoding::ASCII_8BIT)

      loop do
        chunk = reader.read(INFLATE_CHUNK_BYTES)
        break if chunk.nil?
        result << chunk
        if result.bytesize > max_bytes
          raise OversizedPayloadError,
                "Feed payload inflated body exceeded max #{max_bytes} bytes (gzip bomb?)"
        end
      end

      result
    ensure
      reader&.close
    end

    # Normalises a body string to valid UTF-8 with no leading BOM.
    # Exposed for CSV-parsing feeds (FIRMS) that want the encoding
    # check without going through JSON.
    def normalise_utf8(body)
      str = body.dup.force_encoding(Encoding::UTF_8)
      unless str.valid_encoding?
        raise PayloadEncodingError, "Feed payload contains invalid UTF-8 bytes"
      end
      str.delete_prefix("\u{FEFF}")
    end
  end
end
