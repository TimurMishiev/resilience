require "rails_helper"

RSpec.describe "StrongMigrations configuration" do
  it "is loaded so new migrations are scanned for unsafe patterns" do
    expect(defined?(StrongMigrations)).to be_truthy
    expect(StrongMigrations.start_after).to be_a(Integer)
  end

  it "never bumps the baseline past an existing migration (drift guard)" do
    # `start_after` silences checks for versions <= its value. The baseline must
    # stay at-or-before the latest migration timestamp — otherwise a landed
    # migration could quietly skip validation. We accept an earlier baseline
    # (historical migrations get re-validated harmlessly), we reject a later
    # one (real unchecked migrations in the tree).
    migration_dir = Rails.root.join("db/migrate")
    versions = Dir.children(migration_dir).filter_map { |f| f[/\A(\d+)/, 1]&.to_i }
    latest = versions.max
    expect(StrongMigrations.start_after).to be <= latest
  end
end
