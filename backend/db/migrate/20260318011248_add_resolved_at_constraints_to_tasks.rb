class AddResolvedAtConstraintsToTasks < ActiveRecord::Migration[8.1]
  def up
    # 1. Enforce: if workflow_status = 'resolved', resolved_at must be set.
    #    Prevents tasks from being resolved without a timestamp.
    execute <<~SQL
      ALTER TABLE tasks
        ADD CONSTRAINT resolved_at_required_when_resolved
        CHECK (workflow_status != 'resolved' OR resolved_at IS NOT NULL);
    SQL

    # 2. Enforce: resolved_at may only be set when the task is resolved.
    #    Prevents future code from stamping a resolved_at on a non-resolved task.
    execute <<~SQL
      ALTER TABLE tasks
        ADD CONSTRAINT resolved_at_only_when_resolved
        CHECK (resolved_at IS NULL OR workflow_status = 'resolved');
    SQL
  end

  def down
    execute "ALTER TABLE tasks DROP CONSTRAINT IF EXISTS resolved_at_required_when_resolved;"
    execute "ALTER TABLE tasks DROP CONSTRAINT IF EXISTS resolved_at_only_when_resolved;"
  end
end
