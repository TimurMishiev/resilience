# Production-shape synthetic dataset generator for the Tranche B load test.
#
# The pre-existing perf/load-test/run.sh driver hits an *unrealistic* dataset
# (the dev seed creates ~12 sites). The reviewers' specific complaint was
# "laptop-grade numbers against laptop-grade data." This task generates a
# production-shape dataset (10K sites / 100K signals / 10K audit events
# across 5 orgs / 20 AOs) so the same driver produces credible numbers when
# pointed at a real Fly machine.
#
# Idempotent: re-running detects the marker organization (slug
# "loadtest-org-1") and short-circuits. Use `rake load_test:reset` to wipe
# and re-seed.
#
# Sizing is env-overridable so a smoke run can use small numbers locally
# before paying for Fly cycles.
#
# Usage:
#   bundle exec rake load_test:seed       # production-shape (default)
#   LT_SITES_PER_AO=10 LT_SIGNALS_PER_SITE=2 LT_AUDIT_EVENTS=20 \
#     bundle exec rake load_test:seed     # smoke
#   bundle exec rake load_test:status     # counts
#   bundle exec rake load_test:reset      # destroy and re-seed cleanly
namespace :load_test do
  # ── Sizing ────────────────────────────────────────────────────────────────
  # Defaults targeted at "production-shape" — large enough that index choice,
  # connection pool sizing, and N+1 patterns matter; small enough to seed in
  # under 5 minutes on a Fly performance-2x machine.
  ORGS              = ENV.fetch("LT_ORGS", "5").to_i
  AOS_PER_ORG       = ENV.fetch("LT_AOS_PER_ORG", "4").to_i
  SITES_PER_AO      = ENV.fetch("LT_SITES_PER_AO", "500").to_i
  SIGNALS_PER_SITE  = ENV.fetch("LT_SIGNALS_PER_SITE", "10").to_i
  AUDIT_EVENTS      = ENV.fetch("LT_AUDIT_EVENTS", "10000").to_i

  # ── Constants ────────────────────────────────────────────────────────────
  ADMIN_EMAIL = "loadtest-admin@loadtest.local"
  ADMIN_PASS  = "loadtest-password-123"
  MARKER_SLUG = "loadtest-org-1"
  ACTOR       = "system:loadtest-seed"

  # 20 geographically dispersed AO centers — one per (org, AO) slot. Real
  # operational deployments cluster around regions; spreading sites this
  # way exercises the geo bounding-box paths in External_Signal.near_point
  # and the map's bounds queries the way prod traffic would.
  AO_CENTERS = [
    [38.9072, -77.0369],   # Washington DC
    [37.7749, -122.4194],  # San Francisco
    [40.7128, -74.0060],   # New York
    [29.7604, -95.3698],   # Houston
    [25.7617, -80.1918],   # Miami
    [51.5074, -0.1278],    # London
    [48.8566, 2.3522],     # Paris
    [52.5200, 13.4050],    # Berlin
    [35.6762, 139.6503],   # Tokyo
    [22.3193, 114.1694],   # Hong Kong
    [-33.8688, 151.2093],  # Sydney
    [1.3521, 103.8198],    # Singapore
    [55.7558, 37.6173],    # Moscow
    [41.0082, 28.9784],    # Istanbul
    [19.0760, 72.8777],    # Mumbai
    [-23.5505, -46.6333],  # Sao Paulo
    [30.0444, 31.2357],    # Cairo
    [-1.2921, 36.8219],    # Nairobi
    [60.1699, 24.9384],    # Helsinki
    [64.1466, -21.9426],   # Reykjavik
  ].freeze

  desc "Seed production-shape synthetic dataset (idempotent)"
  task seed: :environment do
    if Organization.exists?(slug: MARKER_SLUG)
      puts "load_test:seed already applied (#{MARKER_SLUG} exists)."
      puts "Run `rake load_test:status` for counts, or `rake load_test:reset` to re-seed."
      next
    end

    if AO_CENTERS.size < ORGS * AOS_PER_ORG
      abort "AO_CENTERS (#{AO_CENTERS.size}) is smaller than ORGS×AOS_PER_ORG (#{ORGS * AOS_PER_ORG}). Add more centers or reduce sizing."
    end

    started = Time.current
    puts "── Load-test seed starting ──"
    puts "  orgs=#{ORGS} aos_per_org=#{AOS_PER_ORG} sites_per_ao=#{SITES_PER_AO}"
    puts "  signals_per_site=#{SIGNALS_PER_SITE} audit_events=#{AUDIT_EVENTS}"
    puts "  total: #{ORGS * AOS_PER_ORG * SITES_PER_AO} sites, " \
         "#{ORGS * AOS_PER_ORG * SITES_PER_AO * SIGNALS_PER_SITE} signals"
    puts ""

    admin = ensure_loadtest_admin!
    orgs  = create_orgs!
    aos   = create_aos!(orgs, admin)
    sites = bulk_insert_sites!(aos)
    bulk_insert_signals!(sites)
    write_audit_events!(orgs, sites, admin)

    elapsed = (Time.current - started).round(1)
    puts ""
    puts "── Load-test seed complete in #{elapsed}s ──"
    print_status
  end

  desc "Destroy synthetic dataset (no-op if not present)"
  task reset: :environment do
    unless Organization.exists?(slug: MARKER_SLUG)
      puts "load_test:reset — no synthetic data found."
      next
    end

    org_ids = Organization.where("slug LIKE 'loadtest-org-%'").pluck(:id)
    if org_ids.empty?
      puts "load_test:reset — no synthetic orgs found."
      next
    end

    puts "Destroying synthetic data for #{org_ids.size} orgs..."
    started = Time.current

    # Order matters: child rows first to avoid FK violations.
    # ExternalSignals are not org-scoped — find them by external_id prefix.
    deleted_signals = ExternalSignal.where("external_id LIKE 'loadtest-%'").delete_all
    puts "  deleted #{deleted_signals} external_signals"

    site_ids = Site.where(organization_id: org_ids).pluck(:id)
    Task.where(site_id: site_ids).delete_all
    deleted_sites = Site.where(id: site_ids).delete_all
    puts "  deleted #{deleted_sites} sites"

    deleted_aos = AreaOfOperation.where(organization_id: org_ids).delete_all
    puts "  deleted #{deleted_aos} areas_of_operation"

    # AuditEvents are append-only (DB triggers reject DELETE). Don't try to
    # remove them — leave the chain intact. The reset is for re-seeding the
    # operational data shape, not for chain rewinding.
    audit_count = AuditEvent.where(organization_id: org_ids).count
    puts "  preserved #{audit_count} audit_events (append-only, by design)"

    deleted_orgs = Organization.where(id: org_ids).delete_all
    puts "  deleted #{deleted_orgs} organizations"

    user = User.find_by(email: ADMIN_EMAIL)
    if user
      # Don't delete the admin if any audit events still reference its
      # actor string (they will, since chain is preserved). Keep the user
      # row so a follow-up seed reuses the same id.
      puts "  preserved #{ADMIN_EMAIL} (referenced by preserved audit events)"
    end

    elapsed = (Time.current - started).round(1)
    puts "Reset complete in #{elapsed}s."
  end

  desc "Report counts of synthetic dataset"
  task status: :environment do
    print_status
  end

  # ── Helpers ──────────────────────────────────────────────────────────────

  def ensure_loadtest_admin!
    User.find_or_create_by!(email: ADMIN_EMAIL) do |u|
      u.password = ADMIN_PASS
      u.role     = "admin"
    end
  end

  def create_orgs!
    puts "Creating #{ORGS} organizations..."
    ORGS.times.map do |i|
      n = i + 1
      Organization.create!(
        name: "Load Test Org #{n}",
        slug: "loadtest-org-#{n}",
      )
    end
  end

  def create_aos!(orgs, admin)
    puts "Creating #{orgs.size * AOS_PER_ORG} areas of operation..."
    aos = []
    center_idx = 0
    orgs.each_with_index do |org, oi|
      AOS_PER_ORG.times do |ai|
        center = AO_CENTERS[center_idx]
        center_idx += 1
        # Square geofence around center, ~1° per side (~110 km). This is the
        # geometry shape the AO model expects (jsonb GeoJSON-like).
        geometry = {
          "type"        => "Polygon",
          "coordinates" => [[
            [center[1] - 0.5, center[0] - 0.5],
            [center[1] + 0.5, center[0] - 0.5],
            [center[1] + 0.5, center[0] + 0.5],
            [center[1] - 0.5, center[0] + 0.5],
            [center[1] - 0.5, center[0] - 0.5],
          ]],
        }
        aos << AreaOfOperation.create!(
          name:            "Load Test AO #{oi + 1}-#{ai + 1}",
          description:     "Synthetic AO for load test (centered on #{center.join(',')})",
          threat_level:    %w[green amber red].sample,
          posture:         %w[observe defensive].sample,
          color:           %w[#23d160 #ffdd57 #ff3860 #00d1b2].sample,
          geometry:        geometry,
          organization_id: org.id,
          created_by:      admin,
          # Memoize center for site placement below.
        ).tap { |ao| ao.define_singleton_method(:_center) { center } }
      end
    end
    aos
  end

  def bulk_insert_sites!(aos)
    total = aos.size * SITES_PER_AO
    puts "Bulk inserting #{total} sites..."
    rows = []
    timestamp = Time.current
    aos.each do |ao|
      center_lat, center_lng = ao._center
      SITES_PER_AO.times do |i|
        # Random offset within the AO's ~1° square.
        offset_lat = (rand - 0.5) * 0.9
        offset_lng = (rand - 0.5) * 0.9
        rows << {
          id:                  SecureRandom.uuid,
          name:                "LT-#{ao.id[0, 8]}-#{i.to_s.rjust(4, '0')}",
          latitude:            (center_lat + offset_lat).round(6),
          longitude:           (center_lng + offset_lng).round(6),
          status:              "active",
          area_of_operation_id: ao.id,
          organization_id:     ao.organization_id,
          geofence_radius_km:  [25.0, 50.0, 100.0].sample,
          honeytoken:          false,
          created_at:          timestamp,
          updated_at:          timestamp,
        }
      end
    end

    # 5K-row batches keep insert_all's parameter count under Postgres's
    # 65535-parameter ceiling (12 cols × 5000 = 60000 < 65535).
    rows.each_slice(5_000) { |batch| Site.insert_all(batch) }

    Site.where(organization_id: aos.map(&:organization_id).uniq).pluck(:id, :latitude, :longitude, :area_of_operation_id, :organization_id)
  end

  def bulk_insert_signals!(site_tuples)
    total = site_tuples.size * SIGNALS_PER_SITE
    puts "Bulk inserting #{total} external signals..."
    sources_by_type = {
      "aircraft_position" => "opensky",
      "vessel_position"   => "ais",
      "seismic_event"     => "usgs_seismic",
      "gps_jamming"       => "gpsjam",
      "wildfire"          => "firms_wildfire",
      "ais_gap"           => "derived",
      "conflict_event"    => "acled",
      "disaster_alert"    => "gdacs",
    }
    types = sources_by_type.keys
    timestamp_now = Time.current
    window_start  = timestamp_now - 96.hours
    window_span   = 96 * 3600.0

    rows = []
    counter = 0
    site_tuples.each do |(site_id, lat, lng, _ao_id, _org_id)|
      SIGNALS_PER_SITE.times do
        type    = types.sample
        source  = sources_by_type[type]
        offset_lat = (rand - 0.5) * 0.5
        offset_lng = (rand - 0.5) * 0.5
        occurred_at = window_start + (rand * window_span).seconds
        counter += 1

        rows << {
          id:          SecureRandom.uuid,
          source:      source,
          signal_type: type,
          # external_id is unique-per-source in practice; prefix with
          # "loadtest-" so reset can find them.
          external_id: "loadtest-#{counter}",
          lat:         (lat.to_f + offset_lat).round(6),
          lng:         (lng.to_f + offset_lng).round(6),
          raw_payload: { "loadtest" => true, "site_id" => site_id }.to_json,
          occurred_at: occurred_at,
          ingested_at: timestamp_now,
        }
      end

      # Flush in 10K-row batches. external_signals has 10 columns, so
      # 10000 × 10 = 100000 — well under the parameter ceiling. Batch
      # size driven by memory rather than param count for this table.
      if rows.size >= 10_000
        ExternalSignal.insert_all(rows)
        rows.clear
      end
    end

    ExternalSignal.insert_all(rows) if rows.any?
  end

  def write_audit_events!(orgs, site_tuples, admin)
    puts "Writing #{AUDIT_EVENTS} audit events through Audit::EventWriter..."
    org_ids = orgs.map(&:id)
    site_index_by_org = site_tuples.group_by { |t| t[4] }
    timestamp_now = Time.current
    window_start  = timestamp_now - 96.hours
    window_span   = 96 * 3600.0

    AUDIT_EVENTS.times do |i|
      org_id = org_ids.sample
      site_tuple = site_index_by_org[org_id].sample
      next unless site_tuple
      site_id = site_tuple[0]

      Audit::EventWriter.write(
        actor:           ACTOR,
        entity_type:     "Site",
        entity_id:       site_id,
        event_type:      %w[site_inspected site_flagged site_acknowledged].sample,
        action:          "loadtest.synthetic",
        before_snapshot: { "status" => "active" },
        after_snapshot:  { "status" => "active", "loadtest_seq" => i },
        correlation_id:  SecureRandom.uuid,
        organization_id: org_id,
        occurred_at:     window_start + (rand * window_span).seconds,
      )

      print "    audit_events progress: #{i + 1} / #{AUDIT_EVENTS}\r" if (i + 1) % 1_000 == 0
    end
    puts ""
  end

  def print_status
    puts "── Load-test dataset status ──"
    org_ids = Organization.where("slug LIKE 'loadtest-org-%'").pluck(:id)
    if org_ids.empty?
      puts "  (no synthetic data present)"
      return
    end

    site_count   = Site.where(organization_id: org_ids).count
    ao_count     = AreaOfOperation.where(organization_id: org_ids).count
    signal_count = ExternalSignal.where("external_id LIKE 'loadtest-%'").count
    audit_count  = AuditEvent.where(organization_id: org_ids).count
    puts "  organizations:     #{org_ids.size}"
    puts "  areas_of_operation: #{ao_count}"
    puts "  sites:             #{site_count}"
    puts "  external_signals:  #{signal_count}"
    puts "  audit_events:      #{audit_count}"
  end
end
