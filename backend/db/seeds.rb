require "securerandom"

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
  AuditEvent.create!(
    schema_version:  1,
    actor:           ACTOR,
    entity_type:     entity_type,
    entity_id:       entity_id,
    event_type:      event_type,
    action:          action,
    before_snapshot: before_snapshot,
    after_snapshot:  after_snapshot,
    correlation_id:  SecureRandom.uuid,
    occurred_at:     occurred_at
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
SignalRuleMatch.delete_all
AuditEvent.delete_all
Task.delete_all
Asset.delete_all
ExternalSignal.delete_all
CorrelationRule.delete_all
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
  u.password = "password"
  u.role     = "commander"
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
  { name: "MRAP-01",           asset_type: "vehicle",   status: "in_use",      home_site: alpha   }, # deployed at Alpha
  { name: "MRAP-07",           asset_type: "vehicle",   status: "available",   home_site: charlie }, # standby at Charlie
  { name: "Comms Array B3",    asset_type: "equipment", status: "in_use",      home_site: bravo   }, # active relay, Ramstein
  { name: "Comms Array F1",    asset_type: "equipment", status: "maintenance", home_site: foxtrot }, # offline for repair
  { name: "UAV Recon-3",       asset_type: "equipment", status: "in_use",      home_site: echo    }, # airborne, Tel Aviv
  { name: "Field Team 7",      asset_type: "personnel", status: "available",   home_site: golf    }, # Diego Garcia
  { name: "Field Team 12",     asset_type: "personnel", status: "in_use",      home_site: hotel   }, # deployed, Seoul
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
  { email: "commander@resilience.mil", password: "password", role: "commander" },
  { email: "operator@resilience.mil",  password: "password", role: "operator"  }
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
      created_by:      commander,
      cooldown_minutes: 60
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
      created_by:      commander,
      cooldown_minutes: 1440  # 24 hours
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
      created_by:      commander,
      cooldown_minutes: 30
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
      created_by:      commander,
      cooldown_minutes: 120
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
      created_by:      commander,
      cooldown_minutes: 240  # 4 hours
    )
    puts "  Created rule: Wildfire Proximity Alert"
  end
else
  puts "  WARNING: No commander user found — skipping correlation rules seed"
end

# ---------------------------------------------------------------------------
# Demo signals — vessel + wildfire (AIS/FIRMS require API keys; seeded for
# demo purposes so all 5 signal types appear on the map immediately)
# ---------------------------------------------------------------------------
puts "\nSeeding demo signals (vessel + GPS jamming + wildfire)..."

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
      occurred_at: Time.current - i.minutes,
      ingested_at: Time.current,
      raw_payload: attrs[:raw_payload],
    },
    unique_by: :external_id
  )
  puts "  Vessel: #{attrs[:raw_payload][:vessel_name]} (#{attrs[:lat]}, #{attrs[:lng]})"
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
      occurred_at: Time.current - i.minutes,
      ingested_at: Time.current,
      raw_payload: attrs[:raw_payload],
    },
    unique_by: :external_id
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
      occurred_at: Time.current - i.minutes,
      ingested_at: Time.current,
      raw_payload: attrs[:raw_payload],
    },
    unique_by: :external_id
  )
  puts "  Wildfire: FRP #{attrs[:magnitude]} MW (#{attrs[:lat]}, #{attrs[:lng]})"
end

puts "\nSeed complete."
puts "  Areas:            #{AreaOfOperation.count}  (EUCOM amber, CENTCOM red, AFRICOM amber, INDOPACOM green)"
puts "  Sites:            #{Site.count}  (#{Site.where(status: 'active').count} active, #{Site.where(status: 'inactive').count} inactive)"
puts "  Assets:           #{Asset.count}"
puts "  Tasks:            #{Task.count}  (#{Task.group(:workflow_status).count.map { |s, c| "#{c} #{s}" }.join(', ')})"
puts "  Correlation Rules:#{CorrelationRule.count}  (Air/Seismic/GPS/Vessel/Wildfire)"
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
