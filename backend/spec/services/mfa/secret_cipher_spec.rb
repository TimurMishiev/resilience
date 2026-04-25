require "rails_helper"

RSpec.describe Mfa::SecretCipher do
  describe ".encrypt / .decrypt round-trip" do
    it "round-trips a base32 secret" do
      secret = ROTP::Base32.random
      ciphertext = described_class.encrypt(secret)

      expect(ciphertext).not_to be_nil
      expect(ciphertext).not_to include(secret) # ciphertext must not leak plaintext
      expect(described_class.decrypt(ciphertext)).to eq(secret)
    end

    it "round-trips an arbitrary string with non-ASCII bytes safely" do
      plaintext = "TOTP secret with emoji 🔐 and non-ascii ümläuts"
      ciphertext = described_class.encrypt(plaintext)
      expect(described_class.decrypt(ciphertext)).to eq(plaintext)
    end

    it "produces different ciphertext for the same plaintext on each call (random IV)" do
      a = described_class.encrypt("ABCD1234")
      b = described_class.encrypt("ABCD1234")
      expect(a).not_to eq(b)
    end
  end

  describe ".encrypt" do
    it "returns nil for blank input rather than encrypting empty bytes" do
      expect(described_class.encrypt(nil)).to be_nil
      expect(described_class.encrypt("")).to be_nil
    end
  end

  describe ".decrypt" do
    it "returns nil for blank input" do
      expect(described_class.decrypt(nil)).to be_nil
      expect(described_class.decrypt("")).to be_nil
    end

    it "raises ActiveSupport::MessageEncryptor::InvalidMessage on a tampered ciphertext" do
      ciphertext = described_class.encrypt("ABCD1234")
      tampered   = ciphertext.dup
      tampered[10] = (tampered[10] == "X" ? "Y" : "X")

      expect {
        described_class.decrypt(tampered)
      }.to raise_error(ActiveSupport::MessageEncryptor::InvalidMessage)
    end

    it "raises on ciphertext from a different secret_key_base (forgery defence)" do
      ciphertext = described_class.encrypt("ABCD1234")

      # Force a re-derivation under a different secret_key_base —
      # simulates an attacker who lifted ciphertext from a different
      # deployment (or from a build before key rotation).
      original_key = Rails.application.secret_key_base
      allow(Rails.application).to receive(:secret_key_base).and_return("a-completely-different-secret-key-base-with-enough-entropy-to-derive")
      described_class.reset!

      expect {
        described_class.decrypt(ciphertext)
      }.to raise_error(ActiveSupport::MessageEncryptor::InvalidMessage)
    ensure
      allow(Rails.application).to receive(:secret_key_base).and_return(original_key)
      described_class.reset!
    end
  end
end
