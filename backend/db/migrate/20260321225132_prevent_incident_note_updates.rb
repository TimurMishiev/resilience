class PreventIncidentNoteUpdates < ActiveRecord::Migration[8.1]
  # Incident notes are an append-only operational log — they must never be
  # modified after creation. This rule trigger enforces immutability at the
  # database level so it holds even if Rails callbacks are bypassed.
  def up
    execute <<~SQL
      CREATE OR REPLACE FUNCTION prevent_incident_note_update()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'incident_notes are immutable — updates are not permitted';
      END;
      $$;

      CREATE TRIGGER incident_notes_immutable
        BEFORE UPDATE ON incident_notes
        FOR EACH ROW EXECUTE FUNCTION prevent_incident_note_update();
    SQL
  end

  def down
    execute <<~SQL
      DROP TRIGGER IF EXISTS incident_notes_immutable ON incident_notes;
      DROP FUNCTION IF EXISTS prevent_incident_note_update();
    SQL
  end
end
