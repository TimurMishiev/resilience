class BackfillOrganizationIdOnAuditEvents < ActiveRecord::Migration[8.0]
  disable_ddl_transaction!

  def up
    entity_type_sql = {
      "Site" => "UPDATE audit_events SET organization_id = s.organization_id FROM sites s WHERE audit_events.entity_type = 'Site' AND audit_events.entity_id = s.id AND audit_events.organization_id IS NULL",
      "AreaOfOperation" => "UPDATE audit_events SET organization_id = ao.organization_id FROM areas_of_operation ao WHERE audit_events.entity_type = 'AreaOfOperation' AND audit_events.entity_id = ao.id AND audit_events.organization_id IS NULL",
      "User" => "UPDATE audit_events SET organization_id = u.organization_id FROM users u WHERE audit_events.entity_type = 'User' AND audit_events.entity_id = u.id AND audit_events.organization_id IS NULL",
      "Organization" => "UPDATE audit_events SET organization_id = entity_id WHERE entity_type = 'Organization' AND organization_id IS NULL",
      "Task" => "UPDATE audit_events SET organization_id = s.organization_id FROM tasks t JOIN sites s ON s.id = t.site_id WHERE audit_events.entity_type = 'Task' AND audit_events.entity_id = t.id AND audit_events.organization_id IS NULL",
      "Incident" => "UPDATE audit_events SET organization_id = COALESCE(s.organization_id, ao.organization_id) FROM incidents i LEFT JOIN sites s ON s.id = i.site_id LEFT JOIN areas_of_operation ao ON ao.id = i.area_of_operation_id WHERE audit_events.entity_type = 'Incident' AND audit_events.entity_id = i.id AND audit_events.organization_id IS NULL",
      "SignalRuleMatch" => "UPDATE audit_events SET organization_id = s.organization_id FROM signal_rule_matches srm LEFT JOIN sites s ON s.id = srm.site_id WHERE audit_events.entity_type = 'SignalRuleMatch' AND audit_events.entity_id = srm.id AND audit_events.organization_id IS NULL AND s.organization_id IS NOT NULL",
      "Asset" => "UPDATE audit_events SET organization_id = s.organization_id FROM assets a LEFT JOIN sites s ON s.id = a.home_site_id WHERE audit_events.entity_type = 'Asset' AND audit_events.entity_id = a.id AND audit_events.organization_id IS NULL AND s.organization_id IS NOT NULL",
      "CorrelationRule" => "UPDATE audit_events SET organization_id = ao.organization_id FROM correlation_rules cr JOIN areas_of_operation ao ON ao.id = cr.area_of_operation_id WHERE audit_events.entity_type = 'CorrelationRule' AND audit_events.entity_id = cr.id AND audit_events.organization_id IS NULL",
      "Chokepoint" => "UPDATE audit_events SET organization_id = ao.organization_id FROM chokepoints c JOIN areas_of_operation ao ON ao.id = c.area_of_operation_id WHERE audit_events.entity_type = 'Chokepoint' AND audit_events.entity_id = c.id AND audit_events.organization_id IS NULL",
      "CommanderIntent" => "UPDATE audit_events SET organization_id = ao.organization_id FROM commander_intents ci JOIN areas_of_operation ao ON ao.id = ci.area_of_operation_id WHERE audit_events.entity_type = 'CommanderIntent' AND audit_events.entity_id = ci.id AND audit_events.organization_id IS NULL",
      "PacePlan" => "UPDATE audit_events SET organization_id = ao.organization_id FROM pace_plans pp JOIN areas_of_operation ao ON ao.id = pp.area_of_operation_id WHERE audit_events.entity_type = 'PacePlan' AND audit_events.entity_id = pp.id AND audit_events.organization_id IS NULL",
      "SaluteReport" => "UPDATE audit_events SET organization_id = ao.organization_id FROM salute_reports sr JOIN areas_of_operation ao ON ao.id = sr.area_of_operation_id WHERE audit_events.entity_type = 'SaluteReport' AND audit_events.entity_id = sr.id AND audit_events.organization_id IS NULL",
      "Recommendation" => <<~SQL.squish,
        UPDATE audit_events ae SET organization_id = sub.organization_id FROM (
          SELECT r.id, COALESCE(
            s_direct.organization_id,
            s_task.organization_id,
            s_incident.organization_id,
            ao_incident.organization_id,
            s_match.organization_id,
            s_asset.organization_id
          ) AS organization_id
          FROM recommendations r
          LEFT JOIN sites s_direct ON r.affected_entity_type = 'Site' AND s_direct.id = r.affected_entity_id
          LEFT JOIN tasks t ON r.affected_entity_type = 'Task' AND t.id = r.affected_entity_id
          LEFT JOIN sites s_task ON s_task.id = t.site_id
          LEFT JOIN incidents i ON r.affected_entity_type = 'Incident' AND i.id = r.affected_entity_id
          LEFT JOIN sites s_incident ON s_incident.id = i.site_id
          LEFT JOIN areas_of_operation ao_incident ON ao_incident.id = i.area_of_operation_id
          LEFT JOIN signal_rule_matches srm ON r.affected_entity_type = 'SignalRuleMatch' AND srm.id = r.affected_entity_id
          LEFT JOIN sites s_match ON s_match.id = srm.site_id
          LEFT JOIN assets a ON r.affected_entity_type = 'Asset' AND a.id = r.affected_entity_id
          LEFT JOIN sites s_asset ON s_asset.id = a.home_site_id
        ) sub
        WHERE ae.entity_type = 'Recommendation'
          AND ae.entity_id = sub.id
          AND ae.organization_id IS NULL
          AND sub.organization_id IS NOT NULL
      SQL
    }

    entity_type_sql.each do |entity_type, sql|
      say_with_time("Backfilling #{entity_type}") { execute(sql) }
    end
  end

  def down
    execute("UPDATE audit_events SET organization_id = NULL")
  end
end
