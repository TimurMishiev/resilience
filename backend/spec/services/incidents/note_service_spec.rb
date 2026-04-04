require "rails_helper"

RSpec.describe Incidents::NoteService do
  let(:author)   { create(:user, :operator) }
  let(:incident) { create(:incident) }

  describe "successful creation" do
    it "creates an incident note" do
      result = described_class.call(incident: incident, author: author, body: "Situation developing")

      expect(result).to be_success
      expect(result.payload[:note]).to be_a(IncidentNote)
      expect(result.payload[:note].body).to eq("Situation developing")
      expect(result.payload[:note].incident).to eq(incident)
      expect(result.payload[:note].author).to eq(author)
    end

    it "writes an audit event" do
      expect {
        described_class.call(incident: incident, author: author, body: "Intel received")
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("note_added")
      expect(event.entity_id).to eq(incident.id)
    end

    it "strips whitespace from body" do
      result = described_class.call(incident: incident, author: author, body: "  padded note  ")
      expect(result.payload[:note].body).to eq("padded note")
    end
  end

  describe "validation failures" do
    it "rejects blank body" do
      result = described_class.call(incident: incident, author: author, body: "")

      expect(result).not_to be_success
      expect(result.errors).to include("Note body cannot be blank")
    end

    it "rejects whitespace-only body" do
      result = described_class.call(incident: incident, author: author, body: "   ")

      expect(result).not_to be_success
      expect(result.errors).to include("Note body cannot be blank")
    end

    it "rejects body exceeding max length" do
      long_body = "x" * (IncidentNote::MAX_BODY_LENGTH + 1)
      result = described_class.call(incident: incident, author: author, body: long_body)

      expect(result).not_to be_success
      expect(result.errors.first).to include("cannot exceed")
    end
  end
end
