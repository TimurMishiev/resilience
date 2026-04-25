module Api
  module Admin
    # Admin-only on-demand chain-of-custody verification endpoint
    # (ADR-010). Walks every audit_events chain end-to-end and returns
    # the result so an operator responding to an incident can confirm
    # chain integrity without waiting for the next scheduled sweep.
    #
    # Auth: admin role required. Lower-privilege roles do not see
    # cross-org integrity state.
    class AuditChainController < BaseController
      def index
        authorize :audit_chain, :verify?

        verifications = Audit::ChainVerifier.verify_all

        render json: {
          data: verifications.map(&:to_h_serialisable),
          meta: {
            checked_at:   Time.current.iso8601(3),
            chains:       verifications.size,
            rows_checked: verifications.sum(&:rows_checked),
            all_valid:    verifications.all?(&:valid),
          },
        }
      end
    end
  end
end
