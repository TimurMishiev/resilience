require "securerandom"

# ── Production refusal guard ────────────────────────────────────────────────
# This script does delete_all across 14 operational tables including
# AuditEvent. Running it against a populated production database destroys
# the chain-of-custody log (ADR-010) along with all incidents, signals,
# tasks, and assets. The script's prior assumption — "I'm a development
# seed" (line 3) — was structural intent, not an enforced invariant; any
# operator with a Rails console or a misconfigured FORCE_RESEED flag
# could silently nuke prod.
#
# Defense: refuse to run if RAILS_ENV=production AND audit events exist,
# unless the operator has explicitly opted in with
# ALLOW_DESTRUCTIVE_PROD_SEED=1. Pairs with the docker-entrypoint guard
# which independently requires FORCE_RESEED=true before invoking db:seed
# in production. Two-key protection: an accidental flag flip on either
# side alone is insufficient to trigger destruction.
if Rails.env.production? && AuditEvent.any? && ENV["ALLOW_DESTRUCTIVE_PROD_SEED"] != "1"
  abort(<<~MSG)
    seeds.rb refused to run.

    Environment:           #{Rails.env}
    Audit events present:  #{AuditEvent.count}

    This script calls delete_all on 14 tables (including AuditEvent) and
    would destroy the per-org hash-chained audit log along with all
    operational data. To override this guard, set
    ALLOW_DESTRUCTIVE_PROD_SEED=1.

    Note: docker-entrypoint also requires FORCE_RESEED=true before
    invoking db:seed in production. A genuine reseed of production
    requires BOTH flags to be set deliberately.
  MSG
end

puts "Seeding Resilience development database..."

ACTOR = "system:seed"

# ---------------------------------------------------------------------------
# Timeline anchors — spread history over 96 hours for realistic replay
# ---------------------------------------------------------------------------
NOW  = Time.current
T96H = NOW - 96.hours   # 4 days ago:  sites activated, initial tasks logged
T72H = NOW - 72.hours   # 3 days ago:  second wave of tasks created
T48H = NOW - 48.hours   # 2 days ago:  triage wave across all sites
T36H = NOW - 36.hours   # 36h ago:     work begins on priority items
T24H = NOW - 24.hours   # 24h ago:     complications surface
T12H = NOW - 12.hours   # 12h ago:     first resolutions
T4H  = NOW - 4.hours    # 4h ago:      late-breaking tasks

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def audit_event(entity_type:, entity_id:, event_type:, action:, before_snapshot:, after_snapshot:, occurred_at:)
  # Routes through Audit::EventWriter so every seeded event participates in
  # the chain-of-custody (ADR-010). Direct AuditEvent.create! bypasses chain
  # bookkeeping (chain_position / prev_hash / row_hash), which the post-2026-04-24
  # NOT NULL constraints reject. The writer accepts caller-provided
  # occurred_at so the seed can preserve its multi-day timeline shape
  # (T96H → T4H) while still producing a verifiable chain.
  Audit::EventWriter.write(
    actor:           ACTOR,
    entity_type:     entity_type,
    entity_id:       entity_id,
    event_type:      event_type,
    action:          action,
    before_snapshot: before_snapshot,
    after_snapshot:  after_snapshot,
    correlation_id:  SecureRandom.uuid,
    occurred_at:     occurred_at,
  )
end

def task_snapshot(task, workflow_status:, blocked_reason: nil, resolved_at: nil)
  task.attributes.except("updated_at").merge(
    "workflow_status" => workflow_status,
    "blocked_reason"  => blocked_reason,
    "resolved_at"     => resolved_at&.iso8601
  )
end

# ---------------------------------------------------------------------------
# Clear all seed data — idempotent on re-run
# ---------------------------------------------------------------------------
puts "  Clearing existing data..."
Recommendation.delete_all
SignalRuleMatch.delete_all # must precede Incident (FK: signal_rule_matches.incident_id)
IncidentNote.delete_all if ActiveRecord::Base.connection.table_exists?("incident_notes")
Incident.delete_all        # must precede Site (FK: incidents.site_id)
AuditEvent.delete_all
Task.delete_all
Asset.delete_all
VesselTrack.delete_all
Vessel.delete_all          # must precede ExternalSignal (FK: vessels.last_signal_id)
ExternalSignal.delete_all
CorrelationRule.delete_all
SiteRiskSnapshot.delete_all  # must precede Site (FK: site_risk_snapshots.site_id)
Site.delete_all
AreaOfOperation.delete_all

# ---------------------------------------------------------------------------
# Sites — 9 locations across active operational theaters
# ---------------------------------------------------------------------------

sites_data = [
  # Eastern European theater
  { name: "Site Alpha",   latitude:  52.2297,  longitude:  21.0122, status: "active"   }, # Warsaw, Poland
  { name: "Site Bravo",   latitude:  49.4371,  longitude:   7.6005, status: "active"   }, # Ramstein, Germany (NATO hub)
  { name: "Site Charlie", latitude:  39.9334,  longitude:  32.8597, status: "active"   }, # Ankara, Turkey (NATO flank)

  # Middle East theater
  { name: "Site Delta",   latitude:  24.7136,  longitude:  46.6753, status: "inactive" }, # Riyadh (decommissioning)
  { name: "Site Echo",    latitude:  32.0853,  longitude:  34.7818, status: "active"   }, # Tel Aviv, Israel

  # Horn of Africa / Indian Ocean
  { name: "Site Foxtrot", latitude:  11.5720,  longitude:  43.1456, status: "active"   }, # Djibouti
  { name: "Site Golf",    latitude:  -7.3034,  longitude:  72.4234, status: "active"   }, # Diego Garcia

  # Indo-Pacific theater
  { name: "Site Hotel",   latitude:  37.5665,  longitude: 126.9780, status: "active"   }, # Seoul, South Korea
  { name: "Site India",   latitude:  13.4443,  longitude: 144.7937, status: "active"   }, # Andersen AFB, Guam
]

sites = sites_data.map do |attrs|
  site = Site.create!(attrs)
  audit_event(
    entity_type: "Site", entity_id: site.id,
    event_type: "site.created", action: "create",
    before_snapshot: nil,
    after_snapshot:  site.attributes.except("updated_at"),
    occurred_at: T96H
  )
  puts "  Created site: #{site.name} (#{attrs[:latitude]}, #{attrs[:longitude]})"
  site
end

alpha, bravo, charlie, delta, echo, foxtrot, golf, hotel, india = sites

# ---------------------------------------------------------------------------
# Areas of Operation — 4 theater-level AOs, one per command
# ---------------------------------------------------------------------------
puts "\nSeeding areas of operation..."

commander_for_ao = User.find_or_create_by!(email: "commander@resilience.mil") do |u|
  u.password = "password123"
  u.role     = "commander"
end

User.find_or_create_by!(email: "operator@resilience.mil") do |u|
  u.password = "password123"
  u.role     = "operator"
end

User.find_or_create_by!(email: "viewer@resilience.mil") do |u|
  u.password = "password123"
  u.role     = "viewer"
end

eucom = AreaOfOperation.create!(
  name:         "European Command (EUCOM)",
  description:  "NATO eastern flank operations — Poland, Germany, Turkey theater",
  threat_level: "amber",
  color:        "#ffb347",
  geometry: {
    "type" => "Polygon",
    "coordinates" => [[
      [5.0,  38.0],
      [5.0,  55.0],
      [40.0, 55.0],
      [40.0, 38.0],
      [5.0,  38.0]
    ]]
  },
  created_by: commander_for_ao
)
puts "  Created AO: #{eucom.name}"

centcom = AreaOfOperation.create!(
  name:         "Central Command (CENTCOM)",
  description:  "Middle East operations — Riyadh, Tel Aviv theater",
  threat_level: "red",
  color:        "#ff4757",
  geometry: {
    "type" => "Polygon",
    "coordinates" => [[
      [32.0, 22.0],
      [32.0, 35.0],
      [50.0, 35.0],
      [50.0, 22.0],
      [32.0, 22.0]
    ]]
  },
  created_by: commander_for_ao
)
puts "  Created AO: #{centcom.name}"

africom = AreaOfOperation.create!(
  name:         "Africa Command (AFRICOM)",
  description:  "Horn of Africa and Indian Ocean theater — Djibouti, Diego Garcia",
  threat_level: "amber",
  color:        "#ffb347",
  geometry: {
    "type" => "Polygon",
    "coordinates" => [[
      [40.0, -10.0],
      [40.0,  15.0],
      [75.0,  15.0],
      [75.0, -10.0],
      [40.0, -10.0]
    ]]
  },
  created_by: commander_for_ao
)
puts "  Created AO: #{africom.name}"

indopacom = AreaOfOperation.create!(
  name:         "Indo-Pacific Command (INDOPACOM)",
  description:  "Northeast Asia and Pacific theater — Seoul, Guam",
  threat_level: "green",
  color:        "#23d160",
  geometry: {
    "type" => "Polygon",
    "coordinates" => [[
      [118.0, 10.0],
      [118.0, 42.0],
      [150.0, 42.0],
      [150.0, 10.0],
      [118.0, 10.0]
    ]]
  },
  created_by: commander_for_ao
)
puts "  Created AO: #{indopacom.name}"

# Assign sites to their AOs
alpha.update!(area_of_operation: eucom)
bravo.update!(area_of_operation: eucom)
charlie.update!(area_of_operation: eucom)
delta.update!(area_of_operation: centcom)
echo.update!(area_of_operation: centcom)
foxtrot.update!(area_of_operation: africom)
golf.update!(area_of_operation: africom)
hotel.update!(area_of_operation: indopacom)
india.update!(area_of_operation: indopacom)
puts "  Assigned all 9 sites to their AOs"

# ---------------------------------------------------------------------------
# Assets — 7 across multiple types and statuses
# ---------------------------------------------------------------------------

assets_data = [
  { name: "MRAP-01",           asset_type: "vehicle",   status: "assigned",  home_site: alpha   }, # deployed at Alpha
  { name: "MRAP-07",           asset_type: "vehicle",   status: "available",  home_site: charlie }, # standby at Charlie
  { name: "Comms Array B3",    asset_type: "equipment", status: "assigned",  home_site: bravo   }, # active relay, Ramstein
  { name: "Comms Array F1",    asset_type: "equipment", status: "degraded",  home_site: foxtrot }, # degraded, needs repair
  { name: "UAV Recon-3",       asset_type: "equipment", status: "assigned",  home_site: echo    }, # airborne, Tel Aviv
  { name: "Field Team 7",      asset_type: "personnel", status: "available",  home_site: golf    }, # Diego Garcia
  { name: "Field Team 12",     asset_type: "personnel", status: "assigned",  home_site: hotel   }, # deployed, Seoul
]

assets = assets_data.map do |attrs|
  home = attrs.delete(:home_site)
  asset = Asset.create!(attrs.merge(home_site: home))
  audit_event(
    entity_type: "Asset", entity_id: asset.id,
    event_type: "asset.created", action: "create",
    before_snapshot: nil,
    after_snapshot:  asset.attributes.except("updated_at"),
    occurred_at: T96H
  )
  puts "  Created asset: #{asset.name} [#{asset.status}]"
  asset
end

mrap01, mrap07, comms_b3, comms_f1, uav3, team7, team12 = assets

# ---------------------------------------------------------------------------
# Tasks — 19 tasks across all 9 sites, all 6 workflow states
#
# Replay anchor summary:
#   96h ago — all tasks are "new"
#   72h ago — second wave of tasks created (Echo, Foxtrot, Hotel, India)
#   48h ago — triage wave: most tasks triaged
#   36h ago — active tasks move to in_progress
#   24h ago — two tasks blocked; Intel brief moves to in_progress
#   12h ago — three tasks resolved
#   4h ago  — two late-breaking tasks created
# ---------------------------------------------------------------------------

puts "  Seeding tasks..."

# ── Site Alpha (Warsaw) ─────────────────────────────────────────────────────

# Task 1: Forward comms — in_progress
t = Task.create!(
  site: alpha, asset: mrap01,
  title: "Establish forward communications network",
  description: "Deploy MRAP-01 with comms package to grid ref 52.31N / 21.04E. Establish encrypted link back to Bravo.",
  priority: "critical", workflow_status: "in_progress"
)
t.update_columns(created_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                        after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),    after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T36H)
puts "    #{t.title} [#{t.workflow_status}]"

# Task 2: Personnel accountability — triaged
t = Task.create!(
  site: alpha,
  title: "Personnel accountability check — Alpha roster",
  description: "Full headcount and duty-status verification for all 48 personnel assigned to Alpha.",
  priority: "high", workflow_status: "triaged"
)
t.update_columns(created_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                    after_snapshot: task_snapshot(t, workflow_status: "new"),     occurred_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"), after_snapshot: task_snapshot(t, workflow_status: "triaged"), occurred_at: T48H)
puts "    #{t.title} [#{t.workflow_status}]"

# Task 3: EOD clearance — blocked
blocked_reason = "EOD team redirected to Bravo — ETA to Alpha is 36 hours pending reassignment"
t = Task.create!(
  site: alpha,
  title: "EOD clearance — forward staging area",
  description: "Explosive ordnance disposal sweep required before staging area can be activated for vehicle movement.",
  priority: "high", workflow_status: "blocked", blocked_reason: blocked_reason
)
t.update_columns(created_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                        after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),    after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T36H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "in_progress"), after_snapshot: task_snapshot(t, workflow_status: "blocked", blocked_reason: blocked_reason), occurred_at: T24H)
puts "    #{t.title} [#{t.workflow_status}]"

# Task 4: Host-nation liaison — resolved
resolved_time = T12H
t = Task.create!(
  site: alpha,
  title: "Coordinate with host-nation liaison",
  description: "Initial coordination meeting with Polish MoD liaison. Establish shared communication protocols.",
  priority: "normal", workflow_status: "resolved", resolved_at: resolved_time
)
t.update_columns(created_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                        after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),    after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T36H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "in_progress"), after_snapshot: task_snapshot(t, workflow_status: "resolved", resolved_at: resolved_time), occurred_at: resolved_time)
puts "    #{t.title} [#{t.workflow_status}]"

# ── Site Bravo (Ramstein) ───────────────────────────────────────────────────

# Task 5: ISR relay firmware — in_progress
t = Task.create!(
  site: bravo, asset: comms_b3,
  title: "Upgrade ISR relay station firmware — Bravo",
  description: "Apply security patch v4.2.1 to Comms Array B3. 4-hour maintenance window required. Coordinate with EUCOM NOC.",
  priority: "critical", workflow_status: "in_progress"
)
t.update_columns(created_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                        after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),    after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T36H)
puts "    #{t.title} [#{t.workflow_status}]"

# Task 6: NATO interoperability drill — resolved
resolved_time = T12H - 1.hour
t = Task.create!(
  site: bravo,
  title: "NATO interoperability exercise — comms protocols",
  description: "Joint communications exercise with German and French units to validate cross-platform encrypted voice.",
  priority: "high", workflow_status: "resolved", resolved_at: resolved_time
)
t.update_columns(created_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                        after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),    after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T36H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "in_progress"), after_snapshot: task_snapshot(t, workflow_status: "resolved", resolved_at: resolved_time), occurred_at: resolved_time)
puts "    #{t.title} [#{t.workflow_status}]"

# Task 7: Logistics manifests — new (late-breaking)
t = Task.create!(
  site: bravo,
  title: "Audit Q1 logistics manifests",
  description: "Reconcile all inbound and outbound manifests against physical inventory. Flag discrepancies for JAG review.",
  priority: "normal", workflow_status: "new"
)
t.update_columns(created_at: T4H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created", action: "create", before_snapshot: nil, after_snapshot: task_snapshot(t, workflow_status: "new"), occurred_at: T4H)
puts "    #{t.title} [#{t.workflow_status}]"

# ── Site Charlie (Ankara) ───────────────────────────────────────────────────

# Task 8: Perimeter reinforcement — in_progress
t = Task.create!(
  site: charlie, asset: mrap07,
  title: "Reinforce perimeter access control — eastern gate",
  description: "Upgrade vehicle barrier and biometric scanner at eastern access point. MRAP-07 staged for immediate response.",
  priority: "high", workflow_status: "in_progress"
)
t.update_columns(created_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                        after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),    after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T36H)
puts "    #{t.title} [#{t.workflow_status}]"

# Task 9: Threat matrix update — resolved
resolved_time = T12H - 3.hours
t = Task.create!(
  site: charlie,
  title: "Update threat matrix — eastern corridor",
  description: "Incorporate SIGINT reporting from the last 24h into the site threat assessment. Distribute to duty officers.",
  priority: "critical", workflow_status: "resolved", resolved_at: resolved_time
)
t.update_columns(created_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                        after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),    after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T36H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "in_progress"), after_snapshot: task_snapshot(t, workflow_status: "resolved", resolved_at: resolved_time), occurred_at: resolved_time)
puts "    #{t.title} [#{t.workflow_status}]"

# ── Site Delta (Riyadh — inactive) ─────────────────────────────────────────

# Task 10: Equipment demobilization — in_progress
t = Task.create!(
  site: delta,
  title: "Equipment demobilization — Delta standdown",
  description: "Document, palletize, and manifest all Class VII equipment for airlift to Bravo. Completion required before site handover.",
  priority: "critical", workflow_status: "in_progress"
)
t.update_columns(created_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                        after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),    after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T36H)
puts "    #{t.title} [#{t.workflow_status}]"

# Task 11: Site records transfer — triaged
t = Task.create!(
  site: delta,
  title: "Transfer site records to Central Archive",
  description: "Digitize and transmit all physical site records to DIA central archive per AR 25-55.",
  priority: "normal", workflow_status: "triaged"
)
t.update_columns(created_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                    after_snapshot: task_snapshot(t, workflow_status: "new"),     occurred_at: T96H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"), after_snapshot: task_snapshot(t, workflow_status: "triaged"), occurred_at: T48H)
puts "    #{t.title} [#{t.workflow_status}]"

# ── Site Echo (Tel Aviv) ────────────────────────────────────────────────────

# Task 12: UAV route recon — in_progress
t = Task.create!(
  site: echo, asset: uav3,
  title: "UAV route reconnaissance — Highway 1 corridor",
  description: "Launch UAV Recon-3 for 4-hour pattern-of-life flight along Highway 1. Capture HD imagery for route clearance assessment.",
  priority: "high", workflow_status: "in_progress"
)
t.update_columns(created_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                        after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),    after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T36H)
puts "    #{t.title} [#{t.workflow_status}]"

# Task 13: Port access road — blocked
blocked_reason = "Local authority access denial — diplomatic clearance request submitted, awaiting MFA response"
t = Task.create!(
  site: echo,
  title: "Assess infrastructure damage — port access road",
  description: "Engineer team to inspect bridge and road damage on primary port access route. Required for resupply convoy planning.",
  priority: "critical", workflow_status: "blocked", blocked_reason: blocked_reason
)
t.update_columns(created_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                        after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),    after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T36H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "in_progress"), after_snapshot: task_snapshot(t, workflow_status: "blocked", blocked_reason: blocked_reason), occurred_at: T24H)
puts "    #{t.title} [#{t.workflow_status}]"

# ── Site Foxtrot (Djibouti) ─────────────────────────────────────────────────

# Task 14: Maritime surveillance repair — in_progress
t = Task.create!(
  site: foxtrot, asset: comms_f1,
  title: "Repair maritime surveillance array — Foxtrot",
  description: "Comms Array F1 sustained lightning damage. Replace LNB assembly and recalibrate azimuth alignment.",
  priority: "critical", workflow_status: "in_progress"
)
t.update_columns(created_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                        after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),    after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T36H)
puts "    #{t.title} [#{t.workflow_status}]"

# Task 15: Maritime resupply coordination — triaged
t = Task.create!(
  site: foxtrot,
  title: "Coordinate resupply via maritime corridor",
  description: "Arrange fuel and provisions delivery through Bab-el-Mandeb corridor. Coordinate with NAVCENT logistics.",
  priority: "high", workflow_status: "triaged"
)
t.update_columns(created_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                    after_snapshot: task_snapshot(t, workflow_status: "new"),     occurred_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"), after_snapshot: task_snapshot(t, workflow_status: "triaged"), occurred_at: T48H)
puts "    #{t.title} [#{t.workflow_status}]"

# ── Site Golf (Diego Garcia) ────────────────────────────────────────────────

# Task 16: Runway certification — triaged
t = Task.create!(
  site: golf, asset: team7,
  title: "Certify runway for heavy transport operations",
  description: "Field Team 7 to conduct runway inspection and FOD clearance. Submit NOTAM to PACOM prior to first C-17 movement.",
  priority: "high", workflow_status: "triaged"
)
t.update_columns(created_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                    after_snapshot: task_snapshot(t, workflow_status: "new"),     occurred_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"), after_snapshot: task_snapshot(t, workflow_status: "triaged"), occurred_at: T48H)
puts "    #{t.title} [#{t.workflow_status}]"

# ── Site Hotel (Seoul) ──────────────────────────────────────────────────────

# Task 17: Intel fusion morning brief — resolved
resolved_time = T12H - 2.hours
t = Task.create!(
  site: hotel, asset: team12,
  title: "Intelligence fusion cell — morning brief",
  description: "Consolidate overnight reporting from SIGINT, HUMINT, and imagery. Brief J2 at 0800 local.",
  priority: "normal", workflow_status: "resolved", resolved_at: resolved_time
)
t.update_columns(created_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                        after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),    after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T24H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "in_progress"), after_snapshot: task_snapshot(t, workflow_status: "resolved", resolved_at: resolved_time), occurred_at: resolved_time)
puts "    #{t.title} [#{t.workflow_status}]"

# Task 18: ATC protocol synchronization — in_progress
t = Task.create!(
  site: hotel,
  title: "Synchronize ATC protocols with ROKAF",
  description: "Update shared air traffic control procedures in preparation for combined OPLAN exercise next week.",
  priority: "high", workflow_status: "in_progress"
)
t.update_columns(created_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                        after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),    after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T36H)
puts "    #{t.title} [#{t.workflow_status}]"

# ── Site India (Guam) ───────────────────────────────────────────────────────

# Task 19: Fuel cache pre-position — new (late-breaking)
t = Task.create!(
  site: india,
  title: "Pre-position fuel reserves — forward cache India",
  description: "Stage JP-8 reserves at forward cache per PACAF tasking order. Coordinate ground transport from Andersen main depot.",
  priority: "critical", workflow_status: "new"
)
t.update_columns(created_at: T4H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created", action: "create", before_snapshot: nil, after_snapshot: task_snapshot(t, workflow_status: "new"), occurred_at: T4H)
puts "    #{t.title} [#{t.workflow_status}]"

# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

puts "  Seeding users..."

[
  { email: "commander@resilience.mil", password: "password123", role: "commander" },
  { email: "operator@resilience.mil",  password: "password123", role: "operator"  },
  { email: "viewer@resilience.mil",    password: "password123", role: "viewer"    }
].each do |attrs|
  user = User.find_or_initialize_by(email: attrs[:email])
  user.assign_attributes(password: attrs[:password], role: attrs[:role])
  user.save!
  puts "  #{user.new_record? ? 'Created' : 'Updated'} user: #{user.email} [#{user.role}]"
end

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Correlation Rules — 3 starter rules for the intelligence-to-action engine
# ---------------------------------------------------------------------------
puts "\nSeeding correlation rules..."

commander = User.find_by(role: "commander")

if commander
  eucom_ao = AreaOfOperation.find_by(name: "European Command (EUCOM)")

  unless CorrelationRule.exists?(name: "Unplanned Air Activity Near Site")
    CorrelationRule.create!(
      name:                 "Unplanned Air Activity Near Site",
      description:          "Fires when any aircraft is detected within 30km of an active EUCOM site. Creates a high-priority task for the duty officer to investigate.",
      is_active:            true,
      area_of_operation:    eucom_ao,
      conditions: {
        "signal_type"          => "aircraft_position",
        "proximity_km"         => 30,
        "site_id"              => nil,
        "count_threshold"      => 1,
        "time_window_minutes"  => 5
      },
      actions: {
        "create_task" => {
          "title"       => "Air activity detected near {{site_name}}",
          "description" => "Correlation engine detected an aircraft within {{proximity_km}}km of {{site_name}}. Verify identification and intent. Signal source: OpenSky.",
          "priority"    => "high"
        }
      },
      created_by:       commander,
      cooldown_minutes: 60,
      mitre_tags:       %w[T1590 T1591]
    )
    puts "  Created rule: Unplanned Air Activity Near Site"
  end

  unless CorrelationRule.exists?(name: "Seismic Event Near Site")
    CorrelationRule.create!(
      name:                 "Seismic Event Near Site",
      description:          "Fires when a seismic event of magnitude 4.5 or greater occurs within 75km of any active EUCOM site. Creates a high-priority damage assessment task.",
      is_active:            true,
      area_of_operation:    eucom_ao,
      conditions: {
        "signal_type"          => "seismic_event",
        "proximity_km"         => 75,
        "site_id"              => nil,
        "magnitude_min"        => 4.5,
        "count_threshold"      => 1,
        "time_window_minutes"  => 60
      },
      actions: {
        "create_task" => {
          "title"       => "Seismic event — assess {{site_name}}",
          "description" => "Magnitude {{magnitude_min}}+ seismic event detected within {{proximity_km}}km. Conduct immediate structural and personnel damage assessment. Signal source: USGS.",
          "priority"    => "high"
        }
      },
      created_by:       commander,
      cooldown_minutes: 1440,  # 24 hours
      mitre_tags:       %w[T0879 T0880]
    )
    puts "  Created rule: Seismic Event Near Site"
  end

  unless CorrelationRule.exists?(name: "GPS Jamming Detected")
    CorrelationRule.create!(
      name:                 "GPS Jamming Detected",
      description:          "Fires when GPS interference is detected within 100km of any active EUCOM site. Creates a critical task to shift to alternate navigation procedures.",
      area_of_operation:    eucom_ao,
      is_active:        true,
      conditions: {
        "signal_type"          => "gps_jamming",
        "proximity_km"         => 100,
        "site_id"              => nil,
        "count_threshold"      => 1,
        "time_window_minutes"  => 30
      },
      actions: {
        "create_task" => {
          "title"       => "GPS jamming active — {{site_name}}",
          "description" => "GPS interference signal detected within {{proximity_km}}km of {{site_name}}. Activate alternate navigation procedures immediately. Do not rely on GPS-dependent systems until all-clear.",
          "priority"    => "critical"
        }
      },
      created_by:       commander,
      cooldown_minutes: 30,
      mitre_tags:       %w[T1562 T0826 T1498]
    )
    puts "  Created rule: GPS Jamming Detected"
  end

  # Phase D — vessel activity rule (AFRICOM — Bab-el-Mandeb / Horn of Africa chokepoint)
  africom_ao = AreaOfOperation.find_by(name: "Africa Command (AFRICOM)")
  unless CorrelationRule.exists?(name: "Vessel Activity Near Site")
    CorrelationRule.create!(
      name:                 "Vessel Activity Near Site",
      description:          "Fires when a vessel is detected within 50km of an active AFRICOM site. Creates a medium-priority task to identify and assess vessel intent in the maritime corridor.",
      is_active:            true,
      area_of_operation:    africom_ao,
      conditions: {
        "signal_type"          => "vessel_position",
        "proximity_km"         => 50,
        "site_id"              => nil,
        "count_threshold"      => 1,
        "time_window_minutes"  => 15
      },
      actions: {
        "create_task" => {
          "title"       => "Vessel detected near {{site_name}}",
          "description" => "AIS feed detected a vessel within {{proximity_km}}km of {{site_name}}. Identify vessel (MMSI, name, flag) and assess intent. Check against known vessel watch-list. Signal source: AIS.",
          "priority"    => "normal"
        }
      },
      created_by:       commander,
      cooldown_minutes: 120,
      mitre_tags:       %w[T1040 T1590]
    )
    puts "  Created rule: Vessel Activity Near Site"
  end

  # Phase D — wildfire proximity rule (INDOPACOM — Indo-Pacific jungle/island terrain)
  indopacom_ao = AreaOfOperation.find_by(name: "Indo-Pacific Command (INDOPACOM)")
  unless CorrelationRule.exists?(name: "Wildfire Proximity Alert")
    CorrelationRule.create!(
      name:                 "Wildfire Proximity Alert",
      description:          "Fires when a high-intensity wildfire (FRP > 100 MW) is detected within 50km of any active INDOPACOM site. Creates a high-priority task to assess threat to site operations.",
      is_active:            true,
      area_of_operation:    indopacom_ao,
      conditions: {
        "signal_type"          => "wildfire",
        "proximity_km"         => 50,
        "site_id"              => nil,
        "magnitude_min"        => 100,  # FRP in MW — 100 MW = significant fire
        "count_threshold"      => 1,
        "time_window_minutes"  => 60
      },
      actions: {
        "create_task" => {
          "title"       => "Wildfire threat near {{site_name}}",
          "description" => "NASA FIRMS detected a wildfire within {{proximity_km}}km of {{site_name}} with fire radiative power exceeding {{magnitude_min}}MW. Assess air quality, access road status, and evacuation routes. Signal source: NASA FIRMS VIIRS.",
          "priority"    => "high"
        }
      },
      created_by:       commander,
      cooldown_minutes: 240,  # 4 hours
      mitre_tags:       %w[T0879 T0880]
    )
    puts "  Created rule: Wildfire Proximity Alert"
  end

  # Phase 3 — conflict event rule (CENTCOM — Middle East theater)
  centcom_ao = AreaOfOperation.find_by(name: "Central Command (CENTCOM)")
  unless CorrelationRule.exists?(name: "Armed Conflict Near Site")
    CorrelationRule.create!(
      name:              "Armed Conflict Near Site",
      description:       "Fires when ACLED reports an armed conflict event within 100km of any active CENTCOM site. Creates a critical task for threat assessment and force protection review.",
      is_active:         true,
      area_of_operation: centcom_ao,
      conditions: {
        "signal_type"         => "conflict_event",
        "proximity_km"        => 100,
        "site_id"             => nil,
        "count_threshold"     => 1,
        "time_window_minutes" => 120
      },
      actions: {
        "create_task" => {
          "title"       => "Armed conflict detected near {{site_name}}",
          "description" => "ACLED conflict event detected within {{proximity_km}}km of {{site_name}}. Assess threat level, review force protection posture, and coordinate with host-nation security. Signal source: ACLED.",
          "priority"    => "critical"
        }
      },
      created_by:       commander,
      cooldown_minutes: 240,
      mitre_tags:       %w[T0879 T0880 T1583]
    )
    puts "  Created rule: Armed Conflict Near Site"
  end

  # Phase 3 — disaster alert rule (INDOPACOM — Indo-Pacific typhoon/earthquake corridor)
  unless CorrelationRule.exists?(name: "Major Disaster Alert")
    CorrelationRule.create!(
      name:              "Major Disaster Alert",
      description:       "Fires when GDACS reports an Orange or Red-level disaster (score ≥ 1.0) within 300km of any active INDOPACOM site. Creates a high-priority task and flags the site for command attention.",
      is_active:         true,
      area_of_operation: indopacom_ao,
      conditions: {
        "signal_type"         => "disaster_alert",
        "proximity_km"        => 300,
        "site_id"             => nil,
        "magnitude_min"       => 1.0,   # GDACS score ≥ 1.0 = Orange or Red alert level
        "count_threshold"     => 1,
        "time_window_minutes" => 360
      },
      actions: {
        "create_task" => {
          "title"       => "Major disaster alert — {{site_name}} operational impact",
          "description" => "GDACS has issued an Orange/Red disaster alert within {{proximity_km}}km of {{site_name}}. Assess personnel safety, infrastructure integrity, and supply line disruption. Signal source: GDACS.",
          "priority"    => "high"
        },
        "flag_site" => {
          "reason" => "GDACS disaster alert — impact assessment required"
        }
      },
      created_by:       commander,
      cooldown_minutes: 720,
      mitre_tags:       %w[T0879 T0826]
    )
    puts "  Created rule: Major Disaster Alert"
  end

  # Phase 3 — COMPOUND rule: conflict + disaster in same area (CENTCOM)
  # Fires when an armed conflict AND a major disaster are both active near the same site —
  # the compound crisis scenario that demonstrates the AND correlation engine.
  unless CorrelationRule.exists?(name: "Compound Crisis — Conflict and Disaster")
    CorrelationRule.create!(
      name:              "Compound Crisis — Conflict and Disaster",
      description:       "Fires when BOTH an armed conflict event AND a major disaster alert (Orange+) are detected near the same CENTCOM site simultaneously. Escalates an existing task and flags the site — compound crisis protocol.",
      is_active:         true,
      area_of_operation: centcom_ao,
      conditions: {
        "operator" => "AND",
        "conditions" => [
          {
            "signal_type"         => "conflict_event",
            "proximity_km"        => 150,
            "count_threshold"     => 1,
            "time_window_minutes" => 180
          },
          {
            "signal_type"         => "disaster_alert",
            "proximity_km"        => 200,
            "magnitude_min"       => 1.0,
            "count_threshold"     => 1,
            "time_window_minutes" => 360
          }
        ]
      },
      actions: {
        "escalate_task" => {
          "priority"    => "critical",
          "description" => "COMPOUND CRISIS: Armed conflict and major disaster simultaneously active near {{site_name}}. Compound crisis protocol initiated — escalate all in-progress tasks to critical priority."
        },
        "flag_site" => {
          "reason" => "Compound crisis — simultaneous conflict and disaster event"
        }
      },
      created_by:       commander,
      cooldown_minutes: 480,
      mitre_tags:       %w[T0879 T0880 T0826 T1583]
    )
    puts "  Created rule: Compound Crisis — Conflict and Disaster"
  end
else
  puts "  WARNING: No commander user found — skipping correlation rules seed"
end

# ---------------------------------------------------------------------------
# Demo signals — vessel + wildfire (AIS/FIRMS require API keys; seeded for
# demo purposes so all 5 signal types appear on the map immediately)
# ---------------------------------------------------------------------------
puts "\nSeeding demo signals (vessel + GPS jamming + wildfire + conflict + disaster)..."

vessel_signals = [
  # Gulf of Aden — near Site Foxtrot (Djibouti 11.57, 43.14)
  { external_id: "DEMO-AIS-001", lat:  11.82, lng:  43.55, speed: 7.2,  heading: 275, raw_payload: { mmsi: "123456001", vessel_name: "MSC ATHENS",     flag: "LR", vessel_type: "Cargo"  } },
  { external_id: "DEMO-AIS-002", lat:  12.31, lng:  43.72, speed: 12.5, heading: 142, raw_payload: { mmsi: "123456002", vessel_name: "NORDIC HAWK",     flag: "NO", vessel_type: "Tanker" } },
  # Indian Ocean — near Site Golf (Diego Garcia -7.30, 72.42)
  { external_id: "DEMO-AIS-003", lat:  -6.45, lng:  73.18, speed: 9.1,  heading: 210, raw_payload: { mmsi: "123456003", vessel_name: "EVERGREEN GRACE",  flag: "TW", vessel_type: "Container" } },
  { external_id: "DEMO-AIS-004", lat:  -7.82, lng:  71.54, speed: 14.3, heading: 55,  raw_payload: { mmsi: "123456004", vessel_name: "GULF PIONEER",     flag: "AE", vessel_type: "Tanker" } },
  # Mediterranean — near Site Echo (Tel Aviv 32.08, 34.78)
  { external_id: "DEMO-AIS-005", lat:  31.55, lng:  34.45, speed: 4.8,  heading: 320, raw_payload: { mmsi: "123456005", vessel_name: "OFER FORTUNE",     flag: "IL", vessel_type: "Cargo"  } },
  # Pacific shipping lane — near Site India (Guam 13.44, 144.79)
  { external_id: "DEMO-AIS-006", lat:  13.15, lng: 144.32, speed: 11.7, heading: 85,  raw_payload: { mmsi: "123456006", vessel_name: "PACIFIC VOYAGER",  flag: "MH", vessel_type: "Container" } },
]

demo_base_time = Time.zone.parse("2026-01-01T00:00:00Z")

vessel_signals.each_with_index do |attrs, i|
  ExternalSignal.upsert(
    {
      source:      "ais",
      signal_type: "vessel_position",
      external_id: attrs[:external_id],
      lat:         attrs[:lat],
      lng:         attrs[:lng],
      speed:       attrs[:speed],
      heading:     attrs[:heading],
      occurred_at: demo_base_time - i.minutes,
      ingested_at: Time.current,
      raw_payload: attrs[:raw_payload],
    },
    unique_by: %i[source external_id occurred_at]
  )
  puts "  Vessel: #{attrs[:raw_payload][:vessel_name]} (#{attrs[:lat]}, #{attrs[:lng]})"
end

puts "  Seeding Vessel records from demo AIS signals..."
ExternalSignal.where(signal_type: "vessel_position", source: "ais")
              .where("external_id LIKE 'DEMO-AIS-%'")
              .each_with_index do |signal, i|
  vessel, = Vessel.upsert_from_signal!(signal)
  # Seed a few historical track points per vessel
  3.times do |j|
    VesselTrack.find_or_create_by(vessel: vessel, occurred_at: signal.occurred_at - (j + 1).hours) do |t|
      t.lat     = (signal.lat.to_f + (rand * 0.1 - 0.05)).round(4)
      t.lng     = (signal.lng.to_f + (rand * 0.1 - 0.05)).round(4)
      t.speed   = signal.speed
      t.heading = signal.heading
    end
  end
  puts "  Vessel seeded: #{signal.raw_payload["vessel_name"] || signal.raw_payload[:vessel_name]} (#{vessel.mmsi})"
end

wildfire_signals = [
  # Near Site India (Guam 13.44, 144.79) — INDOPACOM, triggers Wildfire rule (FRP > 100)
  { external_id: "DEMO-FIRMS-001", lat:  13.22, lng: 144.61, magnitude: 185.0, raw_payload: { frp: 185.0, brightness: 342.1, confidence: "h", satellite: "N" } },
  # Near Site Hotel (Seoul 37.56, 126.97) — INDOPACOM
  { external_id: "DEMO-FIRMS-002", lat:  37.81, lng: 127.22, magnitude: 124.0, raw_payload: { frp: 124.0, brightness: 328.5, confidence: "h", satellite: "N" } },
  # Near Site Golf (Diego Garcia -7.30, 72.42) — AFRICOM
  { external_id: "DEMO-FIRMS-003", lat:  -7.55, lng:  73.51, magnitude: 210.0, raw_payload: { frp: 210.0, brightness: 361.3, confidence: "h", satellite: "N" } },
  # Horn of Africa — near Site Foxtrot (Djibouti 11.57, 43.14)
  { external_id: "DEMO-FIRMS-004", lat:  10.95, lng:  43.82, magnitude:  78.0, raw_payload: { frp:  78.0, brightness: 312.8, confidence: "n", satellite: "N" } },
]

gps_jam_signals = [
  # Eastern Europe — near Site Alpha (Warsaw 52.22, 21.01) and Charlie (Ankara 39.93, 32.86)
  { external_id: "DEMO-GPS-001", lat:  52.45, lng:  23.80, magnitude: 0.82, raw_payload: { signal_level: 0.82, hex_id: "demo-hex-001", source: "ADS-B derived" } },
  { external_id: "DEMO-GPS-002", lat:  50.10, lng:  29.50, magnitude: 0.71, raw_payload: { signal_level: 0.71, hex_id: "demo-hex-002", source: "ADS-B derived" } },
  { external_id: "DEMO-GPS-003", lat:  39.20, lng:  36.40, magnitude: 0.91, raw_payload: { signal_level: 0.91, hex_id: "demo-hex-003", source: "ADS-B derived" } },
  # Middle East — near Site Echo (Tel Aviv 32.08, 34.78)
  { external_id: "DEMO-GPS-004", lat:  31.80, lng:  35.20, magnitude: 0.88, raw_payload: { signal_level: 0.88, hex_id: "demo-hex-004", source: "ADS-B derived" } },
]

gps_jam_signals.each_with_index do |attrs, i|
  ExternalSignal.upsert(
    {
      source:      "gpsjam",
      signal_type: "gps_jamming",
      external_id: attrs[:external_id],
      lat:         attrs[:lat],
      lng:         attrs[:lng],
      magnitude:   attrs[:magnitude],
      occurred_at: demo_base_time - i.minutes,
      ingested_at: Time.current,
      raw_payload: attrs[:raw_payload],
    },
    unique_by: %i[source external_id occurred_at]
  )
  puts "  GPS Jam: #{(attrs[:magnitude] * 100).round}% intensity (#{attrs[:lat]}, #{attrs[:lng]})"
end

wildfire_signals.each_with_index do |attrs, i|
  ExternalSignal.upsert(
    {
      source:      "firms_wildfire",
      signal_type: "wildfire",
      external_id: attrs[:external_id],
      lat:         attrs[:lat],
      lng:         attrs[:lng],
      magnitude:   attrs[:magnitude],
      occurred_at: demo_base_time - i.minutes,
      ingested_at: Time.current,
      raw_payload: attrs[:raw_payload],
    },
    unique_by: %i[source external_id occurred_at]
  )
  puts "  Wildfire: FRP #{attrs[:magnitude]} MW (#{attrs[:lat]}, #{attrs[:lng]})"
end

# ---------------------------------------------------------------------------
# Demo conflict events — ACLED (gated on ACLED_API_KEY; seeded for demo)
# ---------------------------------------------------------------------------
puts "\nSeeding demo ACLED conflict events..."

acled_signals = [
  # Eastern Ukraine — near Site Alpha (Warsaw 52.23, 21.01)
  {
    external_id: "DEMO-ACLED-001",
    lat: 49.50, lng: 31.20,
    magnitude: 12.0,
    raw_payload: {
      event_type: "Explosions/Remote violence", sub_event_type: "Shelling/artillery/missiles",
      actor1: "Armed Forces of Russia", actor2: "Armed Forces of Ukraine",
      country: "Ukraine", fatalities: 12,
      notes: "Artillery exchange along the eastern front line. Multiple residential structures struck."
    }
  },
  # Northern Syria — near Site Charlie (Ankara 39.93, 32.86)
  {
    external_id: "DEMO-ACLED-002",
    lat: 36.20, lng: 37.10,
    magnitude: 24.0,
    raw_payload: {
      event_type: "Battles", sub_event_type: "Armed clash",
      actor1: "Syrian Armed Forces", actor2: "Hayat Tahrir al-Sham",
      country: "Syria", fatalities: 24,
      notes: "Ground assault in the northwest. Coalition air support requested."
    }
  },
  # Gaza Strip — near Site Echo (Tel Aviv 32.08, 34.78)
  {
    external_id: "DEMO-ACLED-003",
    lat: 31.35, lng: 34.30,
    magnitude: 8.0,
    raw_payload: {
      event_type: "Explosions/Remote violence", sub_event_type: "Air/drone strike",
      actor1: "Israeli Air Force", actor2: "Hamas",
      country: "Palestine", fatalities: 8,
      notes: "Precision strike on military infrastructure. Civilian proximity flagged."
    }
  },
  # Somalia — near Site Foxtrot (Djibouti 11.57, 43.15)
  {
    external_id: "DEMO-ACLED-004",
    lat: 10.20, lng: 44.90,
    magnitude: 5.0,
    raw_payload: {
      event_type: "Battles", sub_event_type: "Government regains territory",
      actor1: "Somali National Army", actor2: "Al-Shabaab",
      country: "Somalia", fatalities: 5,
      notes: "Government forces recaptured a contested village. Al-Shabaab retreated south."
    }
  },
  # North Korea border — near Site Hotel (Seoul 37.57, 126.98)
  {
    external_id: "DEMO-ACLED-005",
    lat: 37.88, lng: 126.10,
    magnitude: nil,
    raw_payload: {
      event_type: "Explosions/Remote violence", sub_event_type: "Remote explosive/landmine/IED",
      actor1: "North Korean Forces", actor2: "",
      country: "North Korea", fatalities: 0,
      notes: "Artillery provocation near the DMZ. No casualties reported. ROK forces on alert."
    }
  },
]

acled_signals.each_with_index do |attrs, i|
  ExternalSignal.upsert(
    {
      source:      "acled",
      signal_type: "conflict_event",
      external_id: attrs[:external_id],
      lat:         attrs[:lat],
      lng:         attrs[:lng],
      magnitude:   attrs[:magnitude],
      occurred_at: demo_base_time - (100 + i).minutes,
      ingested_at: Time.current,
      raw_payload: attrs[:raw_payload],
    },
    unique_by: %i[source external_id occurred_at]
  )
  label = attrs[:raw_payload][:event_type]
  puts "  Conflict: #{label} (#{attrs[:lat]}, #{attrs[:lng]})#{attrs[:magnitude] ? " — #{attrs[:magnitude].to_i} fatalities" : ""}"
end

# ---------------------------------------------------------------------------
# Demo disaster alerts — GDACS (public feed; seeded for demo so map is live)
# ---------------------------------------------------------------------------
puts "\nSeeding demo GDACS disaster alerts..."

gdacs_signals = [
  # Earthquake Turkey — near Site Charlie (Ankara 39.93, 32.86) — Orange
  {
    external_id: "DEMO-GDACS-001",
    lat: 37.80, lng: 38.50,
    magnitude: 1.8,
    raw_payload: {
      event_type: "EQ", event_type_name: "Earthquake",
      event_id: 9900001, episode_id: 9910001,
      name: "Earthquake in Turkey", country: "Turkey", iso3: "TUR",
      alert_level: "Orange", alert_score: 1.8,
      severity_text: "Magnitude 6.2M, Depth:12km", severity_value: 6.2, severity_unit: "M",
      is_current: "true"
    }
  },
  # Earthquake Eastern Mediterranean — near Site Echo (Tel Aviv 32.08, 34.78) — Orange
  {
    external_id: "DEMO-GDACS-002",
    lat: 33.50, lng: 36.40,
    magnitude: 1.2,
    raw_payload: {
      event_type: "EQ", event_type_name: "Earthquake",
      event_id: 9900002, episode_id: 9910002,
      name: "Earthquake in Lebanon", country: "Lebanon", iso3: "LBN",
      alert_level: "Orange", alert_score: 1.2,
      severity_text: "Magnitude 5.8M, Depth:10km", severity_value: 5.8, severity_unit: "M",
      is_current: "true"
    }
  },
  # Flood Horn of Africa — near Site Foxtrot (Djibouti 11.57, 43.15) — Green
  {
    external_id: "DEMO-GDACS-003",
    lat: 9.50, lng: 42.80,
    magnitude: 0.8,
    raw_payload: {
      event_type: "FL", event_type_name: "Flood",
      event_id: 9900003, episode_id: 9910003,
      name: "Flood in Ethiopia", country: "Ethiopia", iso3: "ETH",
      alert_level: "Green", alert_score: 0.8,
      severity_text: "Magnitude 1 (GLOFAS severity score)", severity_value: 1.0, severity_unit: "",
      is_current: "true"
    }
  },
  # Typhoon Indo-Pacific — near Site India (Guam 13.44, 144.79) — Red
  {
    external_id: "DEMO-GDACS-004",
    lat: 16.50, lng: 146.00,
    magnitude: 2.3,
    raw_payload: {
      event_type: "TC", event_type_name: "Tropical Cyclone",
      event_id: 9900004, episode_id: 9910004,
      name: "Tropical Cyclone Mariana", country: "Federated States of Micronesia", iso3: "FSM",
      alert_level: "Red", alert_score: 2.3,
      severity_text: "Maximum wind speed 185 km/h", severity_value: 185.0, severity_unit: "km/h",
      is_current: "true"
    }
  },
  # Earthquake Japan — near Site Hotel (Seoul 37.57, 126.98) — Red
  {
    external_id: "DEMO-GDACS-005",
    lat: 38.50, lng: 141.50,
    magnitude: 2.1,
    raw_payload: {
      event_type: "EQ", event_type_name: "Earthquake",
      event_id: 9900005, episode_id: 9910005,
      name: "Earthquake in Japan", country: "Japan", iso3: "JPN",
      alert_level: "Red", alert_score: 2.1,
      severity_text: "Magnitude 6.8M, Depth:35km", severity_value: 6.8, severity_unit: "M",
      is_current: "true"
    }
  },
]

gdacs_signals.each_with_index do |attrs, i|
  ExternalSignal.upsert(
    {
      source:      "gdacs",
      signal_type: "disaster_alert",
      external_id: attrs[:external_id],
      lat:         attrs[:lat],
      lng:         attrs[:lng],
      magnitude:   attrs[:magnitude],
      occurred_at: demo_base_time - (200 + i).minutes,
      ingested_at: Time.current,
      raw_payload: attrs[:raw_payload],
    },
    unique_by: %i[source external_id occurred_at]
  )
  level = attrs[:raw_payload][:alert_level]
  name  = attrs[:raw_payload][:name]
  puts "  Disaster [#{level}]: #{name} (#{attrs[:lat]}, #{attrs[:lng]})"
end

puts "\nSeed complete."

# ---------------------------------------------------------------------------
# Risk Score History — 7 days of hourly snapshots per active site
# ---------------------------------------------------------------------------
# Gives the chart realistic trend data from day 1 without waiting for
# Risk::SnapshotJob to accumulate real history. Each site gets a distinct
# trajectory so the chart looks like a real operational picture:
#
#   Eastern Europe (Alpha/Bravo/Charlie) — elevated, trending up late
#   Middle East    (Echo)                — high, spiked around T36H
#   Horn of Africa (Foxtrot)             — moderate, slowly declining
#   Indian Ocean   (Golf)               — low baseline
#   Indo-Pacific   (Hotel/India)         — moderate with a mid-week spike
# ---------------------------------------------------------------------------

puts "\nSeeding risk score history..."

RISK_LEVELS = [
  { max: 25,  level: "low"      },
  { max: 50,  level: "moderate" },
  { max: 75,  level: "high"     },
  { max: 100, level: "critical" }
].freeze

def risk_level_for(score)
  RISK_LEVELS.find { |r| score <= r[:max] }&.fetch(:level) || "critical"
end

# Per-site baseline and trajectory — produces visually distinct trend lines.
SITE_RISK_PROFILES = {
  "Alpha"   => { base_score: 38, amplitude: 18, phase: 0.0,  trend: +0.3 },
  "Bravo"   => { base_score: 44, amplitude: 12, phase: 1.1,  trend: +0.2 },
  "Charlie" => { base_score: 29, amplitude: 10, phase: 2.3,  trend: -0.1 },
  "Delta"   => { base_score: 15, amplitude:  5, phase: 0.5,  trend:  0.0 }, # inactive, still show history
  "Echo"    => { base_score: 61, amplitude: 22, phase: 0.8,  trend: -0.4 },
  "Foxtrot" => { base_score: 42, amplitude:  8, phase: 1.7,  trend: -0.2 },
  "Golf"    => { base_score: 18, amplitude:  6, phase: 3.0,  trend: +0.1 },
  "Hotel"   => { base_score: 35, amplitude: 14, phase: 0.3,  trend: +0.1 },
  "India"   => { base_score: 47, amplitude: 16, phase: 2.1,  trend: -0.3 },
}.freeze

# Snapshot every 6 hours over 7 days = 28 snapshots per site
SNAPSHOT_INTERVAL_HOURS = 6
SNAPSHOT_DAYS           = 7
SNAPSHOT_COUNT          = (SNAPSHOT_DAYS * 24) / SNAPSHOT_INTERVAL_HOURS  # 28

sites_with_history = Site.all

inserted = 0
sites_with_history.each do |site|
  profile = SITE_RISK_PROFILES[site.name] || { base_score: 30, amplitude: 10, phase: 0.0, trend: 0.0 }

  SNAPSHOT_COUNT.times do |i|
    hours_ago    = SNAPSHOT_DAYS * 24 - (i * SNAPSHOT_INTERVAL_HOURS)
    snapped_at   = Time.current - hours_ago.hours

    # Sinusoidal variation around a trend line — mimics day/night activity cycles
    t            = i.to_f / SNAPSHOT_COUNT
    wave         = Math.sin((t * 4 * Math::PI) + profile[:phase])
    trend_offset = profile[:trend] * i

    score        = (profile[:base_score] + (wave * profile[:amplitude]) + trend_offset)
                     .clamp(0, 100)
                     .round

    # Split score into three plausible components that sum to total
    # Alert pressure carries the most weight during "spike" periods
    alert_pressure  = (score * 0.42).clamp(0, 40).round(2)
    task_health     = (score * 0.31).clamp(0, 30).round(2)
    signal_density  = (score - alert_pressure - task_health).clamp(0, 30).round(2)
    final_score     = (alert_pressure + task_health + signal_density).round.clamp(0, 100)

    SiteRiskSnapshot.find_or_create_by(
      site:        site,
      recorded_at: snapped_at.change(min: 0, sec: 0)
    ) do |snap|
      snap.score          = final_score
      snap.risk_level     = risk_level_for(final_score)
      snap.alert_pressure = alert_pressure
      snap.task_health    = task_health
      snap.signal_density = signal_density
    end

    inserted += 1
  end
end

# ---------------------------------------------------------------------------
# Recommendations — seeded so the page is populated on a fresh local DB.
# Covers all 6 recommendation_types across both tiers (rule + llm).
# SignalRuleMatches are created here too so alert-scoped types have real FKs.
# ---------------------------------------------------------------------------
puts "\nSeeding recommendations..."

alpha   = Site.find_by(name: "Site Alpha")
echo    = Site.find_by(name: "Site Echo")
foxtrot = Site.find_by(name: "Site Foxtrot")
hotel   = Site.find_by(name: "Site Hotel")
india   = Site.find_by(name: "Site India")

gps_rule      = CorrelationRule.find_by(name: "GPS Jamming Detected")
seismic_rule  = CorrelationRule.find_by(name: "Seismic Event Near Site")
vessel_rule   = CorrelationRule.find_by(name: "Vessel Activity Near Site")
wildfire_rule = CorrelationRule.find_by(name: "Wildfire Proximity Alert")

gps_signal      = ExternalSignal.where(signal_type: "gps_jamming").first
seismic_signal  = ExternalSignal.where(signal_type: "seismic_event").first
vessel_signal   = ExternalSignal.where(signal_type: "vessel_position").first
wildfire_signal = ExternalSignal.where(signal_type: "wildfire").first

# Create a handful of SignalRuleMatches to back the alert-scoped recommendations
stale_match = if alpha && gps_rule && gps_signal
  SignalRuleMatch.find_or_create_by(
    signal: gps_signal, correlation_rule: gps_rule, site: alpha
  ) do |m|
    m.fired_at        = T12H
    m.confidence      = 0.38
    m.workflow_status = "unacknowledged"
    m.metadata        = {}
  end
end

high_conf_match = if echo && seismic_rule && seismic_signal
  SignalRuleMatch.find_or_create_by(
    signal: seismic_signal, correlation_rule: seismic_rule, site: echo
  ) do |m|
    m.fired_at        = T4H
    m.confidence      = 0.84
    m.workflow_status = "unacknowledged"
    m.metadata        = {}
  end
end

vessel_match = if foxtrot && vessel_rule && vessel_signal
  SignalRuleMatch.find_or_create_by(
    signal: vessel_signal, correlation_rule: vessel_rule, site: foxtrot
  ) do |m|
    m.fired_at        = T24H
    m.confidence      = 0.61
    m.workflow_status = "unacknowledged"
    m.metadata        = {}
  end
end

wildfire_match = if india && wildfire_rule && wildfire_signal
  SignalRuleMatch.find_or_create_by(
    signal: wildfire_signal, correlation_rule: wildfire_rule, site: india
  ) do |m|
    m.fired_at        = T4H
    m.confidence      = 0.77
    m.workflow_status = "unacknowledged"
    m.metadata        = {}
  end
end

seed_recs = []

# close_stale_alert — low-confidence GPS jamming alert at Alpha, 12h old
if stale_match
  seed_recs << {
    recommendation_type:  "close_stale_alert",
    tier:                 "rule",
    confidence:           0.85,
    rationale:            "Alert 'GPS Jamming Detected' at Site Alpha has been unacknowledged for 12h with low confidence (38%). Recommend closing to reduce noise.",
    evidence:             [{ type: "alert", id: stale_match.id, detail: "fired_at=#{T12H.iso8601}, conf=0.38" }],
    action_payload:       { alert_id: stale_match.id, to_status: "closed" },
    affected_entity_type: "SignalRuleMatch",
    affected_entity_id:   stale_match.id,
    status:               "pending",
    expires_at:           24.hours.from_now,
  }
end

# acknowledge_alert — high-confidence seismic alert at Echo
if high_conf_match
  seed_recs << {
    recommendation_type:  "acknowledge_alert",
    tier:                 "rule",
    confidence:           0.84,
    rationale:            "High-confidence seismic alert (84%) from 'Seismic Event Near Site' at Site Echo requires attention. Recommend acknowledging to begin triage.",
    evidence:             [{ type: "alert", id: high_conf_match.id, detail: "conf=0.84, fired=#{T4H.iso8601}" }],
    action_payload:       { alert_id: high_conf_match.id, to_status: "acknowledged" },
    affected_entity_type: "SignalRuleMatch",
    affected_entity_id:   high_conf_match.id,
    status:               "pending",
    expires_at:           24.hours.from_now,
  }
end

# acknowledge_alert — vessel match at Foxtrot
if vessel_match
  seed_recs << {
    recommendation_type:  "acknowledge_alert",
    tier:                 "rule",
    confidence:           0.61,
    rationale:            "Vessel activity alert (61%) from 'Vessel Activity Near Site' at Site Foxtrot has been unacknowledged for 24h. Recommend acknowledging to confirm maritime picture.",
    evidence:             [{ type: "alert", id: vessel_match.id, detail: "conf=0.61, fired=#{T24H.iso8601}" }],
    action_payload:       { alert_id: vessel_match.id, to_status: "acknowledged" },
    affected_entity_type: "SignalRuleMatch",
    affected_entity_id:   vessel_match.id,
    status:               "pending",
    expires_at:           24.hours.from_now,
  }
end

# flag_site — Site Hotel elevated risk (rule tier)
if hotel
  seed_recs << {
    recommendation_type:  "flag_site",
    tier:                 "rule",
    confidence:           0.82,
    rationale:            "Site Hotel has sustained elevated risk indicators over the past 24h but is not yet flagged. Flagging will prioritise it in operational views and trigger additional monitoring.",
    evidence:             [{ type: "site", id: hotel.id, detail: "risk_level=elevated, signal_density=high" }],
    action_payload:       { site_id: hotel.id },
    affected_entity_type: "Site",
    affected_entity_id:   hotel.id,
    status:               "pending",
    expires_at:           24.hours.from_now,
  }
end

# create_task — LLM recommendation for Site Echo
if echo
  seed_recs << {
    recommendation_type:  "create_task",
    tier:                 "llm",
    confidence:           0.76,
    rationale:            "Site Echo has multiple unresolved seismic signals and an open blocked task. Based on operational patterns, initiating a structural integrity assessment now reduces incident risk by an estimated 40%.",
    evidence:             [{ type: "site", id: echo.id, detail: "open_blocked_tasks=1, recent_seismic_signals=3" }],
    action_payload:       { site_id: echo.id, suggested_title: "Structural integrity check — Site Echo", priority: "high" },
    affected_entity_type: "Site",
    affected_entity_id:   echo.id,
    status:               "pending",
    expires_at:           48.hours.from_now,
  }
end

# bulk_triage_alerts — Site Alpha alert backlog
if alpha
  seed_recs << {
    recommendation_type:  "bulk_triage_alerts",
    tier:                 "rule",
    confidence:           0.80,
    rationale:            "6 unacknowledged alerts are queued at Site Alpha. Bulk triage can resolve noise and surface actionable items faster.",
    evidence:             [{ type: "site", id: alpha.id, detail: "unacked_count=6" }],
    action_payload:       { site_id: alpha.id, unacked_count: 6 },
    affected_entity_type: "Site",
    affected_entity_id:   alpha.id,
    status:               "pending",
    expires_at:           24.hours.from_now,
  }
end

# create_task — LLM recommendation for Site Foxtrot (maritime posture)
if foxtrot
  seed_recs << {
    recommendation_type:  "create_task",
    tier:                 "llm",
    confidence:           0.69,
    rationale:            "Persistent vessel activity near Site Foxtrot (Djibouti) combined with recent AIS gap signals in the Gulf of Aden suggests coordinated maritime activity. Recommend tasking a maritime patrol assessment.",
    evidence:             [{ type: "site", id: foxtrot.id, detail: "vessel_signals=4, ais_gap_signals=2, last_24h=true" }],
    action_payload:       { site_id: foxtrot.id, suggested_title: "Maritime patrol assessment — Gulf of Aden corridor", priority: "high" },
    affected_entity_type: "Site",
    affected_entity_id:   foxtrot.id,
    status:               "pending",
    expires_at:           48.hours.from_now,
  }
end

# wildfire match acknowledgment
if wildfire_match
  seed_recs << {
    recommendation_type:  "acknowledge_alert",
    tier:                 "rule",
    confidence:           0.77,
    rationale:            "High-confidence wildfire alert (77%) from 'Wildfire Proximity Alert' at Site India has not been acknowledged. Recommend acknowledging and assessing base perimeter risk.",
    evidence:             [{ type: "alert", id: wildfire_match.id, detail: "conf=0.77, fired=#{T4H.iso8601}" }],
    action_payload:       { alert_id: wildfire_match.id, to_status: "acknowledged" },
    affected_entity_type: "SignalRuleMatch",
    affected_entity_id:   wildfire_match.id,
    status:               "pending",
    expires_at:           24.hours.from_now,
  }
end

seed_recs.compact.each { |attrs| Recommendation.create!(attrs) }
puts "  Recommendations: #{Recommendation.count}  (#{Recommendation.where(tier: 'rule').count} rule, #{Recommendation.where(tier: 'llm').count} llm)"
puts "  SignalRuleMatches: #{SignalRuleMatch.count}  (seeded to back alert recommendations)"

puts "  Risk snapshots:   #{SiteRiskSnapshot.count}  (#{SNAPSHOT_COUNT} per site × #{sites_with_history.count} sites)"
puts "  Areas:            #{AreaOfOperation.count}  (EUCOM amber, CENTCOM red, AFRICOM amber, INDOPACOM green)"
puts "  Sites:            #{Site.count}  (#{Site.where(status: 'active').count} active, #{Site.where(status: 'inactive').count} inactive)"
puts "  Assets:           #{Asset.count}"
puts "  Tasks:            #{Task.count}  (#{Task.group(:workflow_status).count.map { |s, c| "#{c} #{s}" }.join(', ')})"
puts "  Correlation Rules:#{CorrelationRule.count}  (Air/Seismic/GPS/Vessel/Wildfire/Conflict/Disaster/Compound)"
puts "  Signals:"
puts "    vessel_position:  #{ExternalSignal.where(signal_type: 'vessel_position').count}  (demo AIS)"
puts "    seismic_event:    #{ExternalSignal.where(signal_type: 'seismic_event').count}  (live USGS — seeded at boot)"
puts "    gps_jamming:      #{ExternalSignal.where(signal_type: 'gps_jamming').count}  (demo GPSJam)"
puts "    wildfire:         #{ExternalSignal.where(signal_type: 'wildfire').count}  (demo FIRMS)"
puts "    conflict_event:   #{ExternalSignal.where(signal_type: 'conflict_event').count}  (demo ACLED)"
puts "    disaster_alert:   #{ExternalSignal.where(signal_type: 'disaster_alert').count}  (demo GDACS)"
puts "  AuditEvents: #{AuditEvent.count}"
puts ""
puts "  Theaters:"
puts "    Eastern Europe — Alpha (Warsaw), Bravo (Ramstein), Charlie (Ankara)"
puts "    Middle East    — Delta (Riyadh, inactive), Echo (Tel Aviv)"
puts "    Horn of Africa — Foxtrot (Djibouti)"
puts "    Indian Ocean   — Golf (Diego Garcia)"
puts "    Indo-Pacific   — Hotel (Seoul), India (Guam)"
puts ""
puts "  Replay anchors:"
puts "    96h ago (#{(NOW - 96.hours).strftime('%H:%M')}):  all tasks are 'new'"
puts "    48h ago (#{(NOW - 48.hours).strftime('%H:%M')}):  triage wave complete"
puts "    36h ago (#{(NOW - 36.hours).strftime('%H:%M')}):  priority tasks in_progress"
puts "    24h ago (#{(NOW - 24.hours).strftime('%H:%M')}):  EOD and port road tasks blocked"
puts "    12h ago (#{(NOW - 12.hours).strftime('%H:%M')}):  liaison, NATO drill, intel brief resolved"
puts "    now:          current state (19 tasks, 3 blocked/resolved/new wave)"
