require "rails_helper"

RSpec.describe "Api::Events", type: :request do
  let(:user) { create(:user) }
  let(:sse_token) { JwtAuthenticatable.encode_sse(user.id) }
  let(:queue) { Queue.new }
  let(:broadcaster) { instance_double(Sse::Broadcaster, subscribe: queue, unsubscribe: nil) }

  before do
    allow(Sse::Broadcaster).to receive(:instance).and_return(broadcaster)
  end

  describe "GET /api/events" do
    around do |example|
      original_user_limit = ENV["SSE_MAX_STREAMS_PER_USER"]

      ENV["SSE_MAX_STREAMS_PER_USER"] = "1"
      example.run
    ensure
      original_user_limit ? ENV["SSE_MAX_STREAMS_PER_USER"] = original_user_limit : ENV.delete("SSE_MAX_STREAMS_PER_USER")
    end

    it "treats a closed queue as terminal before attempting to parse JSON" do
      queue.close

      get "/api/events", params: { token: sse_token }

      expect(response).to have_http_status(:ok)
      expect(response.body).to include("event: connected")
      expect(response.body).not_to include("event: heartbeat")
      expect(broadcaster).to have_received(:unsubscribe).with(queue)
    end

    it "returns 429 when the user already has too many live streams" do
      SseStreamLease.create!(
        user: user,
        stream_name: "telemetry",
        remote_ip: "127.0.0.1",
        lease_key: SecureRandom.uuid,
        expires_at: 5.minutes.from_now,
      )

      get "/api/events", params: { token: sse_token }

      expect(response).to have_http_status(:too_many_requests)
      expect(JSON.parse(response.body).fetch("errors").first).to match(/Too many live streams/)
    end

    it "rate limits repeated stream opens from the same IP" do
      queue.close

      Rack::Attack::SSE_STREAM_OPENS_PER_MINUTE.times do
        get "/api/events", params: { token: sse_token }
        expect(response).to have_http_status(:ok)
      end

      get "/api/events", params: { token: sse_token }

      expect(response).to have_http_status(:too_many_requests)
      expect(response.headers["Retry-After"]).to be_present
    end

    # ── Org-scoped SSE filtering ───────────────────────────────────────────────

    context "org-scoped event filtering" do
      let(:org) { create(:organization) }
      let(:org_user) { create(:user, organization: org) }
      let(:org_sse_token) { JwtAuthenticatable.encode_sse(org_user.id) }

      let(:other_org) { create(:organization) }

      def enqueue_event(event:, organization_id: nil, data: { test: true })
        { event: event, data: data, organization_id: organization_id }.to_json
      end

      it "delivers events matching the user's organization and subscribes with the producer-side org filter" do
        q = Queue.new
        q << enqueue_event(event: "task_created", organization_id: org.id)
        q.close

        allow(broadcaster).to receive(:subscribe).and_return(q)

        get "/api/events", params: { token: org_sse_token }

        expect(response).to have_http_status(:ok)
        expect(response.body).to include("event: task_created")
        # Pins the Tranche 2A wire-up: the controller MUST forward the
        # subscribing user's organization_id so the broadcaster can drop
        # cross-tenant events at publish time. Without this assertion, a
        # regression that called .subscribe with no kwargs would silently
        # restore the pre-2A global fan-out cost while the consumer-side
        # filter kept the suite green.
        expect(broadcaster).to have_received(:subscribe).with(organization_id: org.id)
      end

      it "filters out events from a different organization" do
        q = Queue.new
        q << enqueue_event(event: "task_created", organization_id: other_org.id)
        q.close

        allow(broadcaster).to receive(:subscribe).and_return(q)

        get "/api/events", params: { token: org_sse_token }

        expect(response).to have_http_status(:ok)
        expect(response.body).to include("event: connected")
        expect(response.body).not_to include("event: task_created")
      end

      it "delivers events with nil organization_id (global events) to org users" do
        q = Queue.new
        q << enqueue_event(event: "alert_transitioned", organization_id: nil)
        q.close

        allow(broadcaster).to receive(:subscribe).and_return(q)

        get "/api/events", params: { token: org_sse_token }

        expect(response).to have_http_status(:ok)
        expect(response.body).to include("event: alert_transitioned")
      end

      it "delivers all events to users without an organization (unrestricted) and subscribes without an org filter" do
        unrestricted_user = create(:user, organization: nil)
        unrestricted_token = JwtAuthenticatable.encode_sse(unrestricted_user.id)

        q = Queue.new
        q << enqueue_event(event: "rule_fired", organization_id: org.id)
        q << enqueue_event(event: "task_created", organization_id: other_org.id)
        q.close

        allow(broadcaster).to receive(:subscribe).and_return(q)

        get "/api/events", params: { token: unrestricted_token }

        expect(response).to have_http_status(:ok)
        expect(response.body).to include("event: rule_fired")
        expect(response.body).to include("event: task_created")
        # The unrestricted (no-tenant) subscriber must reach the
        # broadcaster with organization_id: nil so the producer-side
        # filter admits every event regardless of org. Mirror of the
        # org-scoped assertion above; together they pin both branches
        # of the Tranche 2A wire-up.
        expect(broadcaster).to have_received(:subscribe).with(organization_id: nil)
      end

      context "AO-scoped event filtering" do
        let(:ao_a_owner) { create(:user, :commander, organization: org) }
        let(:ao_b_owner) { create(:user, :commander, organization: org) }
        let(:ao_a) { create(:area_of_operation, organization: org, created_by: ao_a_owner) }
        let(:ao_b) { create(:area_of_operation, organization: org, created_by: ao_b_owner) }
        let!(:site_a) { create(:site, organization: org, area_of_operation: ao_a) }
        let!(:site_b) { create(:site, organization: org, area_of_operation: ao_b) }
        let(:ao_scoped_user) { create(:user, organization: org, area_of_operation: ao_a) }
        let(:ao_scoped_token) { JwtAuthenticatable.encode_sse(ao_scoped_user.id) }

        it "filters out same-org events from another AO when area_of_operation_id is explicit" do
          q = Queue.new
          q << enqueue_event(
            event: "planning_updated",
            organization_id: org.id,
            data: { area_of_operation_id: ao_b.id, kind: "pace_plan" },
          )
          q.close

          allow(broadcaster).to receive(:subscribe).and_return(q)

          get "/api/events", params: { token: ao_scoped_token }

          expect(response).to have_http_status(:ok)
          expect(response.body).to include("event: connected")
          expect(response.body).not_to include("event: planning_updated")
        end

        it "filters out same-org events from another AO when only site_id is present" do
          q = Queue.new
          q << enqueue_event(
            event: "task_updated",
            organization_id: org.id,
            data: { site_id: site_b.id, title: "Other AO task" },
          )
          q.close

          allow(broadcaster).to receive(:subscribe).and_return(q)

          get "/api/events", params: { token: ao_scoped_token }

          expect(response).to have_http_status(:ok)
          expect(response.body).to include("event: connected")
          expect(response.body).not_to include("event: task_updated")
        end

        it "delivers same-org events from the user's AO" do
          q = Queue.new
          q << enqueue_event(
            event: "task_updated",
            organization_id: org.id,
            data: { site_id: site_a.id, title: "Same AO task" },
          )
          q.close

          allow(broadcaster).to receive(:subscribe).and_return(q)

          get "/api/events", params: { token: ao_scoped_token }

          expect(response).to have_http_status(:ok)
          expect(response.body).to include("event: task_updated")
        end
      end
    end
  end
end
