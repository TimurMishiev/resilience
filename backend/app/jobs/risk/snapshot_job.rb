module Risk
  # Computes and persists a risk score snapshot for every active site.
  # Scheduled via SolidQueue recurring tasks (config/recurring.yml) — runs hourly.
  #
  # Each run:
  #   1. Iterates all active sites
  #   2. Calls Readiness::CalculationService + Risk::ScoringService (same logic as GET /api/risk_scores)
  #   3. Writes one SiteRiskSnapshot per site
  #   4. Prunes snapshots older than SiteRiskSnapshot::RETENTION_DAYS (90 days)
  #
  # Idempotency: multiple runs within the same hour produce multiple snapshots.
  # The front-end chart groups by hour when rendering, so duplicates are harmless
  # but the hourly schedule keeps the table size predictable (~8760 rows/site/year
  # before retention kicks in → ~78k rows for 9 sites — well within Postgres limits).
  class SnapshotJob < ApplicationJob
    queue_as :background

    def perform
      sites = Site.active.includes(:tasks)
      snapped = 0

      sites.each do |site|
        readiness = Readiness::CalculationService.call(site: site, tasks: site.tasks)
        risk      = Risk::ScoringService.call(
          site:            site,
          readiness_score: readiness.payload[:score]
        )

        next unless risk.success

        SiteRiskSnapshot.create!(
          site:           site,
          score:          risk.payload[:score],
          risk_level:     risk.payload[:risk_level],
          alert_pressure: risk.payload[:components][:alert_pressure],
          task_health:    risk.payload[:components][:task_health],
          signal_density: risk.payload[:components][:signal_density],
          recorded_at:    Time.current
        )

        snapped += 1
      rescue StandardError => e
        Rails.logger.error "[Risk::SnapshotJob] failed for site=#{site.id}: #{e.class}: #{e.message}"
      end

      pruned = SiteRiskSnapshot.prune_old!

      Rails.logger.info "[Risk::SnapshotJob] snapped #{snapped} sites, pruned #{pruned} old records"
    end
  end
end
