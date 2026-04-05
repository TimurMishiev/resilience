require "rails_helper"

RSpec.describe Feeds::TransientErrors do
  describe ".match?" do
    Feeds::TransientErrors::CLASSES.each do |klass|
      it "matches #{klass}" do
        # Some error classes require arguments; instantiate with a generic message.
        exception = begin
          klass.new("test")
        rescue ArgumentError
          klass.new
        end

        expect(described_class.match?(exception)).to be true
      end
    end

    it "does not match JSON::ParserError (non-transient)" do
      expect(described_class.match?(JSON::ParserError.new("bad json"))).to be false
    end

    it "does not match ArgumentError (non-transient)" do
      expect(described_class.match?(ArgumentError.new("bad arg"))).to be false
    end

    it "does not match RuntimeError (non-transient)" do
      expect(described_class.match?(RuntimeError.new("oops"))).to be false
    end
  end

  describe "CLASSES" do
    it "is frozen" do
      expect(Feeds::TransientErrors::CLASSES).to be_frozen
    end

    it "contains only exception classes" do
      Feeds::TransientErrors::CLASSES.each do |klass|
        expect(klass).to be < Exception
      end
    end
  end
end
