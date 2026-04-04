require "rails_helper"

RSpec.describe RevokedJwt, type: :model do
  # ── Validations ─────────────────────────────────────────────────────────────

  describe "validations" do
    it "is valid with factory defaults" do
      expect(build(:revoked_jwt)).to be_valid
    end

    it "requires jti" do
      expect(build(:revoked_jwt, jti: nil)).not_to be_valid
    end

    it "requires expires_at" do
      expect(build(:revoked_jwt, expires_at: nil)).not_to be_valid
    end

    it "enforces jti uniqueness" do
      create(:revoked_jwt, jti: "dup-jti")
      dup = build(:revoked_jwt, jti: "dup-jti")
      expect(dup).not_to be_valid
      expect(dup.errors[:jti]).to be_present
    end
  end

  # ── Scopes ──────────────────────────────────────────────────────────────────

  describe ".active" do
    it "returns only non-expired revocations" do
      active  = create(:revoked_jwt, expires_at: 1.hour.from_now)
      expired = create(:revoked_jwt, expires_at: 1.hour.ago)

      results = described_class.active
      expect(results).to include(active)
      expect(results).not_to include(expired)
    end
  end
end
