class PreventIncidentNoteDeletes < ActiveRecord::Migration[8.1]
  # Incident notes are an append-only operational log — they must never be
  # deleted after creation. This trigger pairs with incident_notes_immutable
  # (which blocks UPDATE) to enforce full immutability at the database layer.
  def up
    execute <<~SQL
      CREATE OR REPLACE FUNCTION prevent_incident_note_delete()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'incident_notes are immutable — deletes are not permitted';
      END;
      $$;

      CREATE TRIGGER incident_notes_no_delete
        BEFORE DELETE ON incident_notes
        FOR EACH ROW EXECUTE FUNCTION prevent_incident_note_delete();
    SQL
  end

  def down
    execute <<~SQL
      DROP TRIGGER IF EXISTS incident_notes_no_delete ON incident_notes;
      DROP FUNCTION IF EXISTS prevent_incident_note_delete();
    SQL
  end
end
