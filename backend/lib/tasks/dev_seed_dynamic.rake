# frozen_string_literal: true

namespace :dev do
  desc <<~DESC.squish
    Populate dynamic operational data on top of db:seed.
    Drives the correlation engine over seeded ExternalSignals (creates
    SignalRuleMatches + Incidents), runs the geofence breach service,
    snapshots site risk, and generates recommendations.
  DESC
  #
  # Why this exists: db:seed creates the static skeleton (Sites, Users,
  # AOs, CorrelationRules, ExternalSignals, baseline AuditEvents) but
  # NOT incidents, signal_rule_matches, or risk snapshots — those are
  # produced dynamically in production by Solid Queue jobs running
  # continuously (Correlations::EvaluateRecentJob every 30s,
  # Risk::SnapshotJob hourly, Recommendations::GenerationJob nightly).
  # Locally the SolidQueue scheduler isn't normally running, so a fresh
  # seed leaves the dashboard mostly empty and the demo looks dead.
  #
  # Run via: bin/rails dev:seed_dynamic
  # Idempotent: safe to run repeatedly. The correlation engine has its
  # own dedup (SignalRuleMatch unique constraint), risk snapshots are
  # bucketed by hour, and recommendations dedupe via the partial unique
  # index on pending+entity.
  task seed_dynamic: :environment do
    abort("dev:seed_dynamic refused: only runs in development. Got Rails.env=#{Rails.env}") unless Rails.env.development?

    # Refuse on a virgin DB. Without seeded Sites and ExternalSignals there's
    # nothing for the correlation engine or geofence service to act on, and
    # the task would silently exit with "rec gen: success=true created=0",
    # making the operator think it worked when it produced nothing useful.
    # Loud abort with explicit remediation is the right contract.
    if Site.count.zero? || ExternalSignal.count.zero?
      abort("dev:seed_dynamic refused: virgin DB (sites=#{Site.count} signals=#{ExternalSignal.count}). Run `bin/rails db:seed` first.")
    end

    puts "[dev:seed_dynamic] starting…"
    before = {
      sites:       Site.count,
      signals:     ExternalSignal.count,
      matches:     SignalRuleMatch.count,
      incidents:   Incident.count,
      tasks:       Task.count,
      recs:        Recommendation.count,
      risk_snaps:  SiteRiskSnapshot.count,
      audit:       AuditEvent.count,
    }
    puts "[dev:seed_dynamic] BEFORE: #{before}"

    # ── Correlation + geofence ────────────────────────────────────────────
    # Mirror EvaluateRecentJob's signal selection but without the cursor
    # bound — we want every seeded signal evaluated, not just "since the
    # last cursor advance". Active sites with a non-zero geofence radius
    # are the geofence-breach inputs, matching production's
    # `Sites::GeofenceBreachService` consumer contract.
    sites = Site.active.where("geofence_radius_km > 0").to_a
    puts "[dev:seed_dynamic] evaluating #{ExternalSignal.count} signals across #{sites.size} active geofenced sites…"

    ExternalSignal.find_each do |signal|
      Correlations::EvaluatorService.call(signal: signal)
      Sites::GeofenceBreachService.call(signal: signal, sites: sites)
    end

    # ── Risk snapshots (hourly bucket) ────────────────────────────────────
    # Risk::SnapshotJob.perform_now writes one snapshot per active site for
    # the current hour bucket. Idempotent on re-run (unique on site_id +
    # recorded_at hour bucket).
    if defined?(Risk::SnapshotJob)
      puts "[dev:seed_dynamic] snapshotting site risk…"
      Risk::SnapshotJob.perform_now
    end

    # ── Recommendation generation ─────────────────────────────────────────
    # GeneratorService runs the rule engine + (if ANTHROPIC_API_KEY set)
    # the LLM enricher. Without an API key the rule-tier still produces
    # recommendations from open incidents, high-confidence unacked alerts,
    # bulk-triage candidates, etc.
    puts "[dev:seed_dynamic] generating recommendations…"
    result = Recommendations::GeneratorService.call
    puts "[dev:seed_dynamic] rec gen: success=#{result.success?} created=#{result.success? ? result.created : '-'} errors=#{result.success? ? '-' : result.errors.join('; ')}"

    after = {
      sites:       Site.count,
      signals:     ExternalSignal.count,
      matches:     SignalRuleMatch.count,
      incidents:   Incident.count,
      tasks:       Task.count,
      recs:        Recommendation.count,
      risk_snaps:  SiteRiskSnapshot.count,
      audit:       AuditEvent.count,
    }
    puts "[dev:seed_dynamic] AFTER:  #{after}"
    puts "[dev:seed_dynamic] DELTA:  " + after.each_with_object({}) { |(k, v), h| h[k] = v - before[k] }.inspect
    puts "[dev:seed_dynamic] done."
  end
end
