require "rails_helper"

RSpec.describe EventPolicy do
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    %i[commander operator viewer].each do |role|
      it "allows stream for #{role}" do
        expect(described_class.new(send(role), :event).stream?).to be true
      end
    end
  end
end
