require "securerandom"

puts "Seeding Resilience development database..."

ACTOR = "system:seed"

# ---------------------------------------------------------------------------
# Sites
# ---------------------------------------------------------------------------

sites_data = [
  { name: "Site Alpha",   latitude:  37.4419,  longitude: -122.1430, status: "active"   }, # Palo Alto, CA
  { name: "Site Bravo",   latitude:  38.8977,  longitude:  -77.0365, status: "active"   }, # Washington, DC
  { name: "Site Charlie", latitude:  51.5074,  longitude:   -0.1278, status: "active"   }, # London, UK
  { name: "Site Delta",   latitude:  33.4484,  longitude: -112.0740, status: "inactive" }  # Phoenix, AZ (offline)
]

sites = sites_data.map do |attrs|
  site = Site.find_or_initialize_by(name: attrs[:name])
  site.assign_attributes(attrs)
  if site.new_record?
    site.save!
    AuditEvent.create!(
      schema_version: 1,
      actor: ACTOR,
      entity_type: "Site",
      entity_id: site.id,
      event_type: "site.created",
      action: "create",
      before_snapshot: nil,
      after_snapshot: site.attributes.except("updated_at"),
      correlation_id: SecureRandom.uuid,
      occurred_at: Time.current
    )
    puts "  Created site: #{site.name}"
  else
    puts "  Skipped (exists): #{site.name}"
  end
  site
end

alpha, bravo, charlie, _delta = sites

# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------

assets_data = [
  { name: "MRAP-01",         asset_type: "vehicle",   status: "available", home_site: alpha   },
  { name: "Comms Array B3",  asset_type: "equipment", status: "in_use",    home_site: bravo   },
  { name: "Field Team 7",    asset_type: "personnel", status: "available", home_site: charlie }
]

assets = assets_data.map do |attrs|
  home = attrs.delete(:home_site)
  asset = Asset.find_or_initialize_by(name: attrs[:name])
  asset.assign_attributes(attrs.merge(home_site: home))
  if asset.new_record?
    asset.save!
    AuditEvent.create!(
      schema_version: 1,
      actor: ACTOR,
      entity_type: "Asset",
      entity_id: asset.id,
      event_type: "asset.created",
      action: "create",
      before_snapshot: nil,
      after_snapshot: asset.attributes.except("updated_at"),
      correlation_id: SecureRandom.uuid,
      occurred_at: Time.current
    )
    puts "  Created asset: #{asset.name}"
  else
    puts "  Skipped (exists): #{asset.name}"
  end
  asset
end

mrap, comms, field_team = assets

# ---------------------------------------------------------------------------
# Tasks — spread across sites with varied workflow states
# ---------------------------------------------------------------------------

tasks_data = [
  {
    site: alpha, asset: mrap,
    title: "Perimeter inspection — north sector",
    description: "Complete perimeter sweep of northern boundary. Report anomalies.",
    priority: "high", workflow_status: "in_progress"
  },
  {
    site: alpha, asset: nil,
    title: "Update site access roster",
    description: "Add new personnel arrivals to the access control list.",
    priority: "normal", workflow_status: "triaged"
  },
  {
    site: alpha, asset: nil,
    title: "Generator maintenance check",
    description: "Scheduled 30-day maintenance inspection of backup generators.",
    priority: "high", workflow_status: "blocked",
    blocked_reason: "Awaiting replacement parts — ETA 48 hours"
  },
  {
    site: bravo, asset: comms,
    title: "Uplink verification — satellite relay B3",
    description: "Verify signal integrity on primary satellite uplink.",
    priority: "critical", workflow_status: "in_progress"
  },
  {
    site: bravo, asset: nil,
    title: "Conduct threat briefing for incoming shift",
    description: "Standard handover brief. Summarize last 12 hours of activity.",
    priority: "normal", workflow_status: "resolved", resolved_at: 3.hours.ago
  },
  {
    site: bravo, asset: nil,
    title: "Review and approve field reports for leadership",
    description: "Consolidate field reports into summary package for command.",
    priority: "high", workflow_status: "new"
  },
  {
    site: charlie, asset: field_team,
    title: "Site survey — expansion zone C2",
    description: "Conduct survey of proposed expansion area in quadrant C2.",
    priority: "normal", workflow_status: "triaged"
  },
  {
    site: charlie, asset: nil,
    title: "Resupply coordination with logistics hub",
    description: "Confirm delivery schedule and manifest for next resupply window.",
    priority: "high", workflow_status: "resolved", resolved_at: 6.hours.ago
  },
  {
    site: charlie, asset: nil,
    title: "Medical supplies inventory audit",
    description: "Count and verify all medical inventory against supply manifest.",
    priority: "normal", workflow_status: "new"
  },
  {
    site: sites[3], asset: nil,
    title: "Site deactivation checklist",
    description: "Complete formal deactivation checklist for Site Delta prior to standdown.",
    priority: "critical", workflow_status: "in_progress"
  }
]

tasks_data.each do |attrs|
  site       = attrs.delete(:site)
  asset      = attrs.delete(:asset)
  resolved_at = attrs.delete(:resolved_at)

  task = Task.new(attrs.merge(site: site, asset: asset))
  task.resolved_at = resolved_at if resolved_at

  if task.save
    AuditEvent.create!(
      schema_version: 1,
      actor: ACTOR,
      entity_type: "Task",
      entity_id: task.id,
      event_type: "task.created",
      action: "create",
      before_snapshot: nil,
      after_snapshot: task.attributes.except("updated_at"),
      correlation_id: SecureRandom.uuid,
      occurred_at: task.created_at
    )
    puts "  Created task: #{task.title} [#{task.workflow_status}]"
  else
    puts "  FAILED task: #{task.title} — #{task.errors.full_messages.join(', ')}"
  end
end

puts "\nSeed complete."
puts "  Sites:       #{Site.count}"
puts "  Assets:      #{Asset.count}"
puts "  Tasks:       #{Task.count}"
puts "  AuditEvents: #{AuditEvent.count}"
