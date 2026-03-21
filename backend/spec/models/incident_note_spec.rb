require 'rails_helper'

RSpec.describe IncidentNote, type: :model do
  subject(:note) { create(:incident_note) }

  describe "validations" do
    it "is valid with a body" do
      expect(note).to be_valid
    end

    it "is invalid with a blank body" do
      expect(build(:incident_note, body: "   ")).not_to be_valid
    end

    it "is invalid when body exceeds MAX_BODY_LENGTH" do
      expect(build(:incident_note, body: "x" * (IncidentNote::MAX_BODY_LENGTH + 1))).not_to be_valid
    end
  end

  describe "immutability" do
    it "raises ReadOnlyRecord on update" do
      expect { note.update!(body: "changed") }
        .to raise_error(ActiveRecord::ReadOnlyRecord)
    end

    it "raises ReadOnlyRecord on destroy" do
      expect { note.destroy! }
        .to raise_error(ActiveRecord::ReadOnlyRecord)
    end

    it "does not raise on initial create" do
      expect { create(:incident_note) }.not_to raise_error
    end
  end

  describe "ordering" do
    it "returns notes in chronological order by default" do
      incident = create(:incident)
      n1 = create(:incident_note, incident: incident, created_at: 2.minutes.ago)
      n2 = create(:incident_note, incident: incident, created_at: 1.minute.ago)
      expect(incident.incident_notes.to_a).to eq [n1, n2]
    end
  end
end
