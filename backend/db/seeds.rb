require "securerandom"

puts "Seeding Resilience development database..."

ACTOR = "system:seed"

# ---------------------------------------------------------------------------
# Timeline anchors — spread history over 72 hours for realistic replay
# ---------------------------------------------------------------------------
NOW  = Time.current
T72H = NOW - 72.hours   # 3 days ago:  tasks created as "new"
T48H = NOW - 48.hours   # 2 days ago:  initial triage wave
T36H = NOW - 36.hours   # 36h ago:     work begins
T24H = NOW - 24.hours   # 24h ago:     complications surface
T12H = NOW - 12.hours   # 12h ago:     first resolutions

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

# Builds a task snapshot hash at a given workflow state.
# Takes the task's stable attributes and overrides the mutable ones.
def task_snapshot(task, workflow_status:, blocked_reason: nil, resolved_at: nil)
  task.attributes.except("updated_at").merge(
    "workflow_status" => workflow_status,
    "blocked_reason"  => blocked_reason,
    "resolved_at"     => resolved_at&.iso8601
  )
end

# ---------------------------------------------------------------------------
# Sites
# ---------------------------------------------------------------------------

sites_data = [
  { name: "Site Alpha",   latitude:  37.4419,  longitude: -122.1430, status: "active"   }, # Palo Alto, CA
  { name: "Site Bravo",   latitude:  38.8977,  longitude:  -77.0365, status: "active"   }, # Washington, DC
  { name: "Site Charlie", latitude:  51.5074,  longitude:   -0.1278, status: "active"   }, # London, UK
  { name: "Site Delta",   latitude:  33.4484,  longitude: -112.0740, status: "inactive" }, # Phoenix, AZ (offline)
  { name: "Site Echo",    latitude:  40.7128,  longitude:  -74.0060, status: "active"   }  # New York, NY
]

sites = sites_data.map do |attrs|
  site = Site.find_or_initialize_by(name: attrs[:name])
  site.assign_attributes(attrs)
  if site.new_record?
    site.save!
    audit_event(
      entity_type: "Site", entity_id: site.id,
      event_type: "site.created", action: "create",
      before_snapshot: nil,
      after_snapshot:  site.attributes.except("updated_at"),
      occurred_at: T72H
    )
    puts "  Created site: #{site.name}"
  else
    puts "  Skipped (exists): #{site.name}"
  end
  site
end

alpha, bravo, charlie, delta = sites

# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------

assets_data = [
  { name: "MRAP-01",        asset_type: "vehicle",   status: "available", home_site: alpha   },
  { name: "Comms Array B3", asset_type: "equipment", status: "in_use",    home_site: bravo   },
  { name: "Field Team 7",   asset_type: "personnel", status: "available", home_site: charlie }
]

assets = assets_data.map do |attrs|
  home  = attrs.delete(:home_site)
  asset = Asset.find_or_initialize_by(name: attrs[:name])
  asset.assign_attributes(attrs.merge(home_site: home))
  if asset.new_record?
    asset.save!
    audit_event(
      entity_type: "Asset", entity_id: asset.id,
      event_type: "asset.created", action: "create",
      before_snapshot: nil,
      after_snapshot:  asset.attributes.except("updated_at"),
      occurred_at: T72H
    )
    puts "  Created asset: #{asset.name}"
  else
    puts "  Skipped (exists): #{asset.name}"
  end
  asset
end

mrap, comms, field_team = assets

# ---------------------------------------------------------------------------
# Tasks — cleared and re-seeded with full transition history
# ---------------------------------------------------------------------------
# Each task is saved in its CURRENT state. Audit events record the full
# journey so replay at any anchor point shows the correct historical state.
#
# Replay anchor summary:
#   72h ago  — all tasks are "new" (just created)
#   48h ago  — most tasks triaged
#   36h ago  — perimeter/uplink/generator/resupply move to in_progress
#   24h ago  — generator blocked; deactivation checklist in_progress; threat brief in_progress
#   12h ago  — threat brief resolved; resupply resolved; site survey triaged
#   now      — current state
# ---------------------------------------------------------------------------

puts "  Clearing existing tasks and task audit events..."
task_ids = Task.pluck(:id)
AuditEvent.where(entity_type: "Task", entity_id: task_ids).delete_all if task_ids.any?
Task.delete_all

# --- Task 1: Perimeter inspection (Alpha) — new → triaged → in_progress ---
t = Task.new(
  site: alpha, asset: mrap,
  title: "Perimeter inspection — north sector",
  description: "Complete perimeter sweep of northern boundary. Report anomalies.",
  priority: "high", workflow_status: "in_progress"
)
t.save!
t.update_columns(created_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                     after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),  after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T36H)
puts "  Created task: #{t.title} [#{t.workflow_status}]"

# --- Task 2: Update site access roster (Alpha) — new → triaged ---
t = Task.new(
  site: alpha,
  title: "Update site access roster",
  description: "Add new personnel arrivals to the access control list.",
  priority: "normal", workflow_status: "triaged"
)
t.save!
t.update_columns(created_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                    after_snapshot: task_snapshot(t, workflow_status: "new"),     occurred_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"), after_snapshot: task_snapshot(t, workflow_status: "triaged"), occurred_at: T48H)
puts "  Created task: #{t.title} [#{t.workflow_status}]"

# --- Task 3: Generator maintenance (Alpha) — new → triaged → in_progress → blocked ---
blocked_reason = "Awaiting replacement parts — ETA 48 hours"
t = Task.new(
  site: alpha,
  title: "Generator maintenance check",
  description: "Scheduled 30-day maintenance inspection of backup generators.",
  priority: "high", workflow_status: "blocked", blocked_reason: blocked_reason
)
t.save!
t.update_columns(created_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                        after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),    after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T36H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "in_progress"), after_snapshot: task_snapshot(t, workflow_status: "blocked", blocked_reason: blocked_reason), occurred_at: T24H)
puts "  Created task: #{t.title} [#{t.workflow_status}]"

# --- Task 4: Uplink verification (Bravo) — new → triaged → in_progress ---
t = Task.new(
  site: bravo, asset: comms,
  title: "Uplink verification — satellite relay B3",
  description: "Verify signal integrity on primary satellite uplink.",
  priority: "critical", workflow_status: "in_progress"
)
t.save!
t.update_columns(created_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                     after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),  after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T36H)
puts "  Created task: #{t.title} [#{t.workflow_status}]"

# --- Task 5: Threat briefing (Bravo) — new → triaged → in_progress → resolved ---
resolved_time = T12H
t = Task.new(
  site: bravo,
  title: "Conduct threat briefing for incoming shift",
  description: "Standard handover brief. Summarize last 12 hours of activity.",
  priority: "normal", workflow_status: "resolved", resolved_at: resolved_time
)
t.save!
t.update_columns(created_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                      after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),   after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T24H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "in_progress"), after_snapshot: task_snapshot(t, workflow_status: "resolved", resolved_at: resolved_time), occurred_at: T12H)
puts "  Created task: #{t.title} [#{t.workflow_status}]"

# --- Task 6: Review field reports (Bravo) — new (recent assignment) ---
t = Task.new(
  site: bravo,
  title: "Review and approve field reports for leadership",
  description: "Consolidate field reports into summary package for command.",
  priority: "high", workflow_status: "new"
)
t.save!
t.update_columns(created_at: T24H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created", action: "create", before_snapshot: nil, after_snapshot: task_snapshot(t, workflow_status: "new"), occurred_at: T24H)
puts "  Created task: #{t.title} [#{t.workflow_status}]"

# --- Task 7: Site survey (Charlie) — new → triaged ---
t = Task.new(
  site: charlie, asset: field_team,
  title: "Site survey — expansion zone C2",
  description: "Conduct survey of proposed expansion area in quadrant C2.",
  priority: "normal", workflow_status: "triaged"
)
t.save!
t.update_columns(created_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                    after_snapshot: task_snapshot(t, workflow_status: "new"),     occurred_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"), after_snapshot: task_snapshot(t, workflow_status: "triaged"), occurred_at: T12H)
puts "  Created task: #{t.title} [#{t.workflow_status}]"

# --- Task 8: Resupply coordination (Charlie) — new → triaged → in_progress → resolved ---
resolved_time = T12H - 2.hours
t = Task.new(
  site: charlie,
  title: "Resupply coordination with logistics hub",
  description: "Confirm delivery schedule and manifest for next resupply window.",
  priority: "high", workflow_status: "resolved", resolved_at: resolved_time
)
t.save!
t.update_columns(created_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                      after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),   after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T36H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "in_progress"), after_snapshot: task_snapshot(t, workflow_status: "resolved", resolved_at: resolved_time), occurred_at: resolved_time)
puts "  Created task: #{t.title} [#{t.workflow_status}]"

# --- Task 9: Medical supplies audit (Charlie) — new ---
t = Task.new(
  site: charlie,
  title: "Medical supplies inventory audit",
  description: "Count and verify all medical inventory against supply manifest.",
  priority: "normal", workflow_status: "new"
)
t.save!
t.update_columns(created_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created", action: "create", before_snapshot: nil, after_snapshot: task_snapshot(t, workflow_status: "new"), occurred_at: T72H)
puts "  Created task: #{t.title} [#{t.workflow_status}]"

# --- Task 10: Site deactivation checklist (Delta) — new → triaged → in_progress ---
t = Task.new(
  site: delta,
  title: "Site deactivation checklist",
  description: "Complete formal deactivation checklist for Site Delta prior to standdown.",
  priority: "critical", workflow_status: "in_progress"
)
t.save!
t.update_columns(created_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.created",     action: "create",     before_snapshot: nil,                                     after_snapshot: task_snapshot(t, workflow_status: "new"),         occurred_at: T72H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "new"),  after_snapshot: task_snapshot(t, workflow_status: "triaged"),     occurred_at: T48H)
audit_event(entity_type: "Task", entity_id: t.id, event_type: "task.transitioned", action: "transition", before_snapshot: task_snapshot(t, workflow_status: "triaged"), after_snapshot: task_snapshot(t, workflow_status: "in_progress"), occurred_at: T24H)
puts "  Created task: #{t.title} [#{t.workflow_status}]"

puts "\nSeed complete."
puts "  Sites:       #{Site.count}"
puts "  Assets:      #{Asset.count}"
puts "  Tasks:       #{Task.count}"
puts "  AuditEvents: #{AuditEvent.count}"
puts ""
puts "  Replay anchors (all times today, local):"
puts "    72h ago (#{(NOW - 72.hours).strftime('%H:%M')}):  all 10 tasks are 'new'"
puts "    48h ago (#{(NOW - 48.hours).strftime('%H:%M')}):  8 tasks triaged"
puts "    36h ago (#{(NOW - 36.hours).strftime('%H:%M')}):  perimeter/uplink/generator/resupply in_progress"
puts "    24h ago (#{(NOW - 24.hours).strftime('%H:%M')}):  generator blocked; threat brief in_progress"
puts "    12h ago (#{(NOW - 12.hours).strftime('%H:%M')}):  threat brief + resupply resolved"
puts "    now:          current state"
