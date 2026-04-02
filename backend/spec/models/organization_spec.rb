require "rails_helper"

RSpec.describe Organization, type: :model do
  describe "validations" do
    it "is valid with name and slug" do
      expect(build(:organization)).to be_valid
    end

    it "requires name" do
      expect(build(:organization, name: "")).not_to be_valid
    end

    it "requires slug" do
      expect(build(:organization, slug: "")).not_to be_valid
    end

    it "requires unique slug" do
      create(:organization, slug: "acme")
      expect(build(:organization, slug: "acme")).not_to be_valid
    end

    it "rejects slugs with uppercase" do
      expect(build(:organization, slug: "ACME")).not_to be_valid
    end

    it "rejects slugs with spaces" do
      expect(build(:organization, slug: "acme corp")).not_to be_valid
    end

    it "accepts slugs with hyphens" do
      expect(build(:organization, slug: "acme-corp")).to be_valid
    end
  end

  describe "associations" do
    let(:org)  { create(:organization) }
    let(:user) { create(:user, organization: org) }
    let(:site) { create(:site, organization: org) }

    it "has_many users" do
      user
      expect(org.users).to include(user)
    end

    it "has_many sites" do
      site
      expect(org.sites).to include(site)
    end
  end

  describe "SitePolicy org isolation" do
    let(:org_a) { create(:organization) }
    let(:org_b) { create(:organization) }
    let(:user_a) { create(:user, organization: org_a) }
    let(:site_a) { create(:site, organization: org_a) }
    let(:site_b) { create(:site, organization: org_b) }

    it "scopes sites to the user's organization" do
      site_a
      site_b
      resolved = SitePolicy::Scope.new(user_a, Site.all).resolve
      expect(resolved).to include(site_a)
      expect(resolved).not_to include(site_b)
    end

    it "returns all sites when user has no organization" do
      unscoped_user = create(:user, organization: nil)
      site_a
      site_b
      resolved = SitePolicy::Scope.new(unscoped_user, Site.all).resolve
      expect(resolved).to include(site_a, site_b)
    end
  end
end
