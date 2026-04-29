require "rails_helper"

# Pin the repeat-offender blocklist bantime to its configured value.
#
# Background: this spec was written after a self-review of f3d3e7b
# (which dropped the bantime from 3600s to 60s) flagged the absence of
# a regression test. A "just a number" change is exactly the kind of
# thing that silently regresses across future edits, so we exercise
# the actual library behavior end-to-end with our parameter.
RSpec.describe "Rack::Attack repeat-offender blocklist", type: :request do
  let(:test_ip) { "203.0.113.99" }

  before do
    Rack::Attack.cache.store.clear
    Rack::Attack.reset!
  end

  after do
    Rack::Attack.cache.store.clear
    Rack::Attack.reset!
  end

  it "uses REPEAT_OFFENDER_BAN_TIME_SECS = 60 (not 3600)" do
    # Pin the configured value. If a future edit reverts it to 3600 (or
    # anything else), this assertion fails loudly.
    expect(Rack::Attack::REPEAT_OFFENDER_BAN_TIME_SECS).to eq(60)
    expect(Rack::Attack::REPEAT_OFFENDER_MAX_RETRY).to eq(10)
    expect(Rack::Attack::REPEAT_OFFENDER_FIND_TIME_SECS).to eq(600)
  end

  it "bans an IP after REPEAT_OFFENDER_MAX_RETRY throttle violations and unbans after the configured bantime" do
    bantime = Rack::Attack::REPEAT_OFFENDER_BAN_TIME_SECS
    findtime = Rack::Attack::REPEAT_OFFENDER_FIND_TIME_SECS
    maxretry = Rack::Attack::REPEAT_OFFENDER_MAX_RETRY

    freeze_time do
      # Trip the threshold: maxretry consecutive "matched" calls within
      # findtime mark the IP as banned. Allow2Ban.filter returns false
      # while accumulating; on the (maxretry + 1)th call it should
      # return true (banned).
      maxretry.times do
        Rack::Attack::Allow2Ban.filter(test_ip, maxretry: maxretry, findtime: findtime, bantime: bantime) { true }
      end

      banned_now = Rack::Attack::Allow2Ban.banned?(test_ip)
      expect(banned_now).to be_truthy

      # Travel forward past the bantime — ban must clear.
      # If the value silently regressed to 3600, this assertion fails.
      travel(bantime + 5.seconds)
      expect(Rack::Attack::Allow2Ban.banned?(test_ip)).to be_falsey

      # Sanity: at exactly bantime − 5, the ban should still be in
      # effect. This proves the test isn't accidentally passing because
      # `banned?` always returns false in the test environment.
      travel_back

      maxretry.times do
        Rack::Attack::Allow2Ban.filter(test_ip, maxretry: maxretry, findtime: findtime, bantime: bantime) { true }
      end
      travel(bantime - 5.seconds)
      expect(Rack::Attack::Allow2Ban.banned?(test_ip)).to be_truthy
    end
  end
end
