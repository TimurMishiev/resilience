class UserSession < ApplicationRecord
  TOUCH_INTERVAL = 5.minutes

  belongs_to :user
  belongs_to :revoked_by, class_name: "User", optional: true

  validates :jti, presence: true, uniqueness: true
  validates :expires_at, presence: true
  validates :last_seen_at, presence: true

  scope :active, -> { where(revoked_at: nil).where("expires_at > ?", Time.current) }
  scope :recent_first, -> { order(last_seen_at: :desc, created_at: :desc) }

  def self.issue!(user:, token_payload:, request:)
    create!(
      user: user,
      jti: token_payload.fetch(:jti),
      user_agent: request.user_agent.to_s.first(255).presence,
      ip_address: request.remote_ip.to_s.first(255).presence,
      last_seen_at: Time.current,
      expires_at: Time.at(token_payload.fetch(:exp).to_i),
    )
  end

  def touch_if_stale!(at: Time.current)
    return if last_seen_at.present? && last_seen_at >= at - TOUCH_INTERVAL

    update_column(:last_seen_at, at)
  end

  def revoke!(actor: nil, reason: "revoked")
    return if revoked_at.present?

    transaction do
      update!(
        revoked_at: Time.current,
        revoked_by: actor,
        revoke_reason: reason,
      )
      JwtAuthenticatable.revoke_payload!(
        jti: jti,
        exp: expires_at.to_i,
      )
    end
  end

  def self.revoke_scope!(scope, actor:, reason:, keep_jti: nil)
    relation = scope
    relation = relation.where.not(jti: keep_jti) if keep_jti.present?

    relation.find_each do |session|
      session.revoke!(actor: actor, reason: reason)
    end
  end
end
