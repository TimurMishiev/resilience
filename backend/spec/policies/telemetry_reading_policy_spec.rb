require "rails_helper"

RSpec.describe TelemetryReadingPolicy do
  let(:site)      { create(:site) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    %i[commander operator viewer].each do |role|
      context "as #{role}" do
        subject { described_class.new(send(role), site) }

        it { is_expected.to be_index }
        it { is_expected.to be_trails }
        it { is_expected.to be_stream }
      end
    end
  end
end
