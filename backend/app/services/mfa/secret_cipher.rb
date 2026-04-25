module Mfa
  # Authenticated symmetric encryption for the per-user TOTP secret.
  #
  # The TOTP secret is the second-factor root of trust — anyone who
  # reads it can mint valid 6-digit codes for the user as long as
  # MFA is enabled. Storing it in plaintext means a database
  # snapshot leak (or a careless logging of attributes hash) leaks
  # the second factor along with the password hash. ActiveRecord
  # encryption would also work, but it requires keypair setup in
  # credentials and a wider deploy contract; this cipher reuses the
  # secret_key_base root of trust the JWT signer already depends
  # on, with HKDF-style key derivation via ActiveSupport::KeyGenerator.
  #
  # The derived key is memoised across calls because key derivation
  # is intentionally slow (PBKDF2-style) — re-deriving on every
  # encrypt/decrypt would put the key derivation cost on the request
  # path. Memoisation is mutex-guarded so two concurrent first calls
  # don't both pay the derivation cost.
  #
  # Versioning: SALT carries an explicit `.v1` suffix. If the cipher
  # ever evolves (different KDF, different cipher mode, different
  # AAD), bump SALT to `.v2` and migrate ciphertexts forward — old
  # rows decrypt under v1 until rotated.
  class SecretCipher
    SALT = "resilience.mfa.totp_secret.v1"
    KEY_BYTES = 32

    @encryptor_mutex = Mutex.new

    class << self
      def encrypt(plaintext)
        return nil if plaintext.blank?
        encryptor.encrypt_and_sign(plaintext)
      end

      def decrypt(ciphertext)
        return nil if ciphertext.blank?
        # Ciphertext arrives as bytea-loaded String (BINARY encoding).
        # MessageEncryptor expects the same UTF-8/ASCII bytes it
        # produced; force_encoding round-trips cleanly.
        encryptor.decrypt_and_verify(ciphertext.to_s.dup.force_encoding(Encoding::UTF_8))
      end

      # Test-only hook so spec runs that mutate Rails.application
      # state (rare) can force a re-derivation. Production code
      # should never call this.
      def reset!
        @encryptor_mutex.synchronize { @encryptor = nil }
      end

      private

      def encryptor
        @encryptor || @encryptor_mutex.synchronize do
          @encryptor ||= begin
            key = ActiveSupport::KeyGenerator
                  .new(Rails.application.secret_key_base)
                  .generate_key(SALT, KEY_BYTES)
            ActiveSupport::MessageEncryptor.new(key)
          end
        end
      end
    end
  end
end
