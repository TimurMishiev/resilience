require "rails_helper"

RSpec.describe VesselPolicy do
  let(:site)      { create(:site) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    %i[commander operator viewer].each do |role|
      context "as #{role}" do
        subject { described_class.new(send(role), site) }

        it { is_expected.to be_index }
        it { is_expected.to be_show }
        it { is_expected.to be_tracks }
      end
    end
  end
end
