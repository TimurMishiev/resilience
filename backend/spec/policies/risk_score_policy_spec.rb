require "rails_helper"

RSpec.describe RiskScorePolicy do
  let(:site)      { create(:site) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    %i[commander operator viewer].each do |role|
      it "allows index for #{role}" do
        expect(described_class.new(send(role), site).index?).to be true
      end
    end
  end
end
