require "rails_helper"

RSpec.describe SessionPolicy do
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    %i[commander operator viewer].each do |role|
      it "allows index for #{role}" do
        expect(described_class.new(send(role), :session).index?).to be true
      end

      it "allows destroy for #{role}" do
        expect(described_class.new(send(role), :session).destroy?).to be true
      end

      it "allows revoke for #{role}" do
        expect(described_class.new(send(role), :session).revoke?).to be true
      end

      it "allows revoke_all for #{role}" do
        expect(described_class.new(send(role), :session).revoke_all?).to be true
      end
    end

    it "allows create without a user (unauthenticated login)" do
      expect(described_class.new(nil, :session).create?).to be true
    end
  end
end
