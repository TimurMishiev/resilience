require "rails_helper"

RSpec.describe Asset, type: :model do
  subject(:asset) { build(:asset) }

  # ── Validations ────────────────────────────────────────────────────────────

  describe "validations" do
    it "is valid with factory defaults" do
      expect(asset).to be_valid
    end

    it "requires name" do
      asset.name = nil
      expect(asset).not_to be_valid
      expect(asset.errors[:name]).to be_present
    end

    it "requires asset_type" do
      asset.asset_type = nil
      expect(asset).not_to be_valid
      expect(asset.errors[:asset_type]).to be_present
    end

    it "rejects invalid status" do
      asset.status = "destroyed"
      expect(asset).not_to be_valid
      expect(asset.errors[:status]).to include(a_string_matching(/is not included/))
    end

    it "accepts all valid statuses" do
      Asset::STATUSES.each do |status|
        asset.status = status
        expect(asset).to be_valid, "expected status '#{status}' to be valid"
      end
    end

    it "accepts all valid asset types" do
      Asset::ASSET_TYPES.each do |type|
        asset.asset_type = type
        expect(asset).to be_valid, "expected asset_type '#{type}' to be valid"
      end
    end
  end

  # ── Constants ──────────────────────────────────────────────────────────────

  describe "STATUSES" do
    it "contains expected statuses" do
      expect(Asset::STATUSES).to eq(%w[available assigned degraded offline])
    end
  end

  describe "ASSET_TYPES" do
    it "contains expected types" do
      expect(Asset::ASSET_TYPES).to eq(%w[vehicle equipment personnel])
    end
  end

  # ── Associations ───────────────────────────────────────────────────────────

  describe "associations" do
    it "belongs to home_site optionally" do
      asset.home_site = nil
      expect(asset).to be_valid
    end

    it "can have a home_site" do
      site = create(:site)
      asset.home_site = site
      expect(asset).to be_valid
      expect(asset.home_site).to eq(site)
    end

    it "has many telemetry_readings" do
      persisted = create(:asset)
      expect(persisted).to respond_to(:telemetry_readings)
    end
  end
end
