# ADR-007: Connector Framework & Provenance Contract

**Status:** Proposed (current shape documented; framework deferred)
**Date:** 2026-04-25

## Context

Resilience ingests external intelligence from seven feeds today:

| Feed | Source service file | Shape |
|---|---|---|
| USGS seismic | `feeds/usgs_seismic_ingestion_service.rb` | HTTP poll, GeoJSON |
| OpenSky aircraft | `feeds/open_sky_ingestion_service.rb` | HTTP poll, JSON |
| AISHub vessels | `feeds/ais_ingestion_service.rb` | HTTP poll, JSON |
| NASA FIRMS fire | `feeds/firms_wildfire_ingestion_service.rb` | HTTP poll, CSV |
| GPSJam | `feeds/gpsjam_ingestion_service.rb` | HTTP poll, GeoJSON |
| GDACS disasters | `feeds/gdacs_ingestion_service.rb` | HTTP poll, RSS |
| ACLED conflict | `feeds/acled_ingestion_service.rb` | HTTP poll, JSON |

These are **flat siblings** — each is its own `ApplicationService`
subclass that owns its HTTP polling, parsing, deduplication, error
handling, and retry. Shared concerns live in three small mixin
modules: `SslHelper`, `TransientErrors`, `PollMetrics`. There is no
unifying connector contract, no provenance schema, and no
source-lineage replay primitive.

The third-pass CTO review's exact words: *"external feed ingestion
is integration-rich, but not yet a hardened connector framework with
full provenance, backpressure, replayable source lineage, or
hostile-data assumptions."*

This is true. This ADR documents the current shape, the gap, and the
contract a future connector framework would need to honour.

## Current shape — what exists

Every feed service today implements roughly this loop:

```ruby
def call
  metrics = Feeds::PollMetrics.new(feed: "<name>")
  uri = URI(BASE_URL)
  http = ssl_http(uri.host, uri.port, timeout: TIMEOUT)
  response = http.get(uri.request_uri)
  return failure if response.code != "200"

  payload = JSON.parse(response.body)
  records = payload.fetch("features").map { |f| transform(f) }

  Signals::IngestService.call(records: records)
  metrics.increment(:successful_polls)
  ServiceResult.success(...)
rescue Net::ReadTimeout, ... => e
  TransientErrors.handle(e, ...)
end
```

**What is good about this shape:**

- Each feed owns its parsing — no premature abstraction across feeds
  that have genuinely different payload shapes (GeoJSON vs RSS vs CSV).
- Deduplication is uniform: `Signals::IngestService` upserts via
  `(source, external_id, occurred_at)` unique index; repeated fetches
  of the same window are idempotent at zero cost.
- Transient-error handling is shared via `TransientErrors`.
- Per-feed metrics via `PollMetrics` flow into `OperationalStatus`
  for the operations dashboard.
- Recurring schedule lives in `config/recurring.yml`, separated from
  service code.

**What is missing — the gap the reviewer identified:**

1. **No provenance schema.** Every `ExternalSignal` carries `source`,
   `external_id`, and `raw_payload` — but no signed hash, no fetch
   timestamp distinct from `occurred_at`, no upstream-version stamp,
   no `connector_version` field. If we later need to re-process a
   feed because the parser changed, we cannot tell which signals were
   parsed by which version of the code.
2. **No backpressure contract.** When a feed returns 10× its normal
   record count (post-incident burst from GDACS, e.g.), services
   pass the whole batch to `Signals::IngestService` synchronously.
   No rate-limiting at the connector boundary, no producer-side
   queuing, no shed-on-overload behaviour.
3. **No replayable source lineage.** `raw_payload` is stored, but
   reconstruct-from-raw is not a documented or tested operation. If
   the parser had a bug for a week, recovering correct state requires
   a manual SQL query and a custom backfill script.
4. **No hostile-data assumptions.** Every feed assumes the upstream
   returns well-formed data within size limits. A maliciously crafted
   GeoJSON with deeply-nested coordinates, a 500MB JSON response, or
   a UTF-8-with-BOM payload that breaks our parser is not defended
   against. Real defence-tech ingestion needs adversarial-input
   posture; portfolio-grade does not.
5. **No connector-level circuit breaker.** Per-feed transient errors
   are caught and retried via `TransientErrors`, but a feed that's
   been failing for 6 hours keeps polling at the same cadence,
   wasting upstream rate limit and our own thread budget. AI services
   have a per-service circuit breaker (`Ai::CircuitBreaker`); feed
   ingestion does not.

## Decision (deferred)

A future `Feeds::Connector` framework should provide:

```ruby
module Feeds
  class Connector
    # Required per-connector subclass interface
    abstract :base_url, :feed_name, :poll_interval_seconds,
             :transient_error_classes, :hostile_input_max_bytes
    abstract def fetch_window(starttime:, endtime:)
    abstract def parse(response)

    # Provided by the framework
    def call
      with_circuit_breaker do
        with_backpressure_guard do
          with_provenance_envelope do
            response = fetch_window(starttime: ..., endtime: ...)
            records  = parse(response)
            Signals::IngestService.call(records: stamp(records))
          end
        end
      end
    end

    private

    def stamp(records)
      records.map do |r|
        r.merge(
          fetched_at: Time.current,
          connector_version: self.class.const_get(:CONNECTOR_VERSION),
          payload_sha256: Digest::SHA256.hexdigest(r.fetch(:raw_payload)),
        )
      end
    end
  end
end
```

This shape would close all five gaps:

- `connector_version` + `payload_sha256` → provenance for replay.
- `with_backpressure_guard` → rate-limit per feed, shed on overload.
- `with_circuit_breaker` → reuse `Ai::CircuitBreaker` pattern; stop
  polling a 6-hour-down feed.
- `hostile_input_max_bytes` → reject oversize payloads before parsing.
- `with_provenance_envelope` → record fetch metadata per batch, not
  per record (cheaper).

## Why this is deferred

Two reasons:

1. **It's not biting today.** All seven feeds are stable, low-volume,
   well-formed. Backpressure has never been needed; the polling
   cadences are conservative. Hostile-data defence is a defence-tech
   concern more than a portfolio-grade concern. Provenance gaps are
   visible in `audit_events` for downstream effects, just not at the
   ingestion boundary.
2. **The right shape is not obvious.** The seven feeds have meaningfully
   different payload shapes (GeoJSON / RSS / CSV / JSON). A premature
   abstraction would force them through one parser interface that
   doesn't naturally fit. Better to extract the framework when an
   eighth feed lands and reveals the truly common axis.

## Consequences

- **Code reviewers** know to push back when a new feed adapter is
  added that does not at minimum: increment `PollMetrics`, use the
  `SslHelper` for HTTPS, and use `TransientErrors` for retry. New
  feeds should also stamp their `ExternalSignal`s with a
  `connector_version` constant in the service module — this lays
  groundwork for the eventual framework migration.
- **Future contributors** see this ADR named in the open-scale-work
  section of the production-readiness memory file. The connector
  framework is documented as a known gap, not silently deferred.
- **Operational hardening roadmap** carries the framework as a
  P2 item — meaningful work for any production deployment but not
  blocking for the current demo posture.

## What this is NOT

- **Not a claim that the current feeds are unsafe.** They handle
  their well-formed-input case correctly. The gap is at the
  framework boundary — defence-in-depth, replayability, and
  ops-visibility — not at the per-feed parsing layer.
- **Not a microservices proposal.** The framework belongs in the
  same Rails monolith. Splitting feed ingestion into a separate
  service is premature given current scale.
- **Not a streaming-engine proposal.** No Kafka, no Flink. The
  recurring-poll model is correct for these feeds; the framework
  layers cross-cutting concerns on top of it without changing the
  data-flow shape.
