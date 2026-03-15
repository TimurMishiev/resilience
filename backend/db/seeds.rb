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
AuditEvent.delete_all
Task.delete_all
Asset.delete_all
Site.delete_all

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

puts "\nSeed complete."
puts "  Sites:       #{Site.count}  (#{Site.where(status: 'active').count} active, #{Site.where(status: 'inactive').count} inactive)"
puts "  Assets:      #{Asset.count}"
puts "  Tasks:       #{Task.count}  (#{Task.group(:workflow_status).count.map { |s, c| "#{c} #{s}" }.join(', ')})"
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
