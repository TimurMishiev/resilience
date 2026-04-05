require "rails_helper"

RSpec.describe Feeds::SslHelper do
  let(:helper_host) do
    Class.new do
      include Feeds::SslHelper
      # Expose ssl_http as public for testing
      public :ssl_http
    end.new
  end

  describe "#ssl_http" do
    it "returns a Net::HTTP with SSL enabled" do
      http = helper_host.ssl_http("example.com", 443)

      expect(http).to be_a(Net::HTTP)
      expect(http.use_ssl?).to be true
    end

    it "sets the CRL-tolerant verify_callback" do
      http = helper_host.ssl_http("example.com", 443)

      expect(http.verify_callback).to eq(Feeds::SslHelper::SSL_VERIFY_CALLBACK)
    end

    it "applies the specified timeout" do
      http = helper_host.ssl_http("example.com", 443, timeout: 30)

      expect(http.open_timeout).to eq(30)
      expect(http.read_timeout).to eq(30)
    end

    it "defaults timeout to 15 seconds" do
      http = helper_host.ssl_http("example.com", 443)

      expect(http.open_timeout).to eq(15)
      expect(http.read_timeout).to eq(15)
    end
  end

  describe "SSL_VERIFY_CALLBACK" do
    let(:callback) { Feeds::SslHelper::SSL_VERIFY_CALLBACK }
    let(:store_ctx) { instance_double(OpenSSL::X509::StoreContext) }

    it "passes through when preverify_ok is true" do
      expect(callback.call(true, store_ctx)).to be true
    end

    it "waives CRL-unavailability error (code 3)" do
      allow(store_ctx).to receive(:error).and_return(3)

      expect(callback.call(false, store_ctx)).to be true
    end

    it "waives CRL-issuer-unavailability error (code 33)" do
      allow(store_ctx).to receive(:error).and_return(33)

      expect(callback.call(false, store_ctx)).to be true
    end

    it "rejects other verification failures (e.g. revoked cert, code 23)" do
      allow(store_ctx).to receive(:error).and_return(23)

      expect(callback.call(false, store_ctx)).to be false
    end

    it "is frozen" do
      expect(callback).to be_frozen
    end
  end
end
