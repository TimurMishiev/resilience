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

    # ── A.3: mid-stream user-scope refresh ──────────────────────────────────────
    # Long-lived event streams (often hours) cached the subscribing user's
    # organization_id and area_of_operation_id at stream open and never
    # refreshed them. An admin-initiated org reassignment, AO revocation, or
    # full account deletion would not propagate to either the broadcaster's
    # producer-side filter or this controller's consumer-side filter until
    # the client reconnected — leaving the stream delivering events for a
    # scope the viewer no longer had.
    #
    # The fix: on every loop iteration, if USER_SCOPE_REFRESH_SECONDS has
    # elapsed since the last refresh, reload the user's scope from the DB
    # (uncached) and (a) update the consumer-side cached values that
    # event_visible_to_scope? compares against, (b) push the new org_id
    # into the broadcaster via update_subscription so future cross-tenant
    # events are filtered at publish time, (c) close the stream entirely
    # if the user row is gone.
    context "A.3 — mid-stream user-scope refresh" do
      let(:org_a) { create(:organization) }
      let(:org_b) { create(:organization) }
      let(:scoped_user) { create(:user, organization: org_a) }
      let(:scoped_token) { JwtAuthenticatable.encode_sse(scoped_user.id) }

      def enqueue_event(event:, organization_id: nil, data: { test: true })
        { event: event, data: data, organization_id: organization_id }.to_json
      end

      it "drops org_a events on the iteration after the user is reassigned to org_b, and pushes the new org_id to the broadcaster" do
        # Stub refresh window to 0 so the check fires on every iteration —
        # a single-request spec can otherwise never elapse 30s of wall
        # clock time. The behavioural contract is independent of the
        # cadence; we only need to prove that when the window has elapsed,
        # the right thing happens.
        stub_const("Api::EventsController::USER_SCOPE_REFRESH_SECONDS", 0)

        # Mid-stream queue: reassigns the user's organization between the
        # first pop (still org_a → event delivered) and the second pop
        # (now org_b → org_a event filtered out by the refreshed
        # consumer-side check).
        payloads = [
          enqueue_event(event: "before_change", organization_id: org_a.id),
          enqueue_event(event: "after_change",  organization_id: org_a.id),
        ]
        update_subscription_calls = []
        mid_stream_queue = Class.new do
          def initialize(payloads, user, new_org)
            @payloads = payloads.dup
            @user = user
            @new_org = new_org
            @pop_count = 0
          end
          def pop
            @pop_count += 1
            @user.update!(organization: @new_org) if @pop_count == 2
            @payloads.shift
          end
          def close; end
          def closed?; @payloads.empty?; end
        end.new(payloads, scoped_user, org_b)

        scope_aware_broadcaster = instance_double(
          Sse::Broadcaster,
          subscribe: mid_stream_queue,
          unsubscribe: nil,
        )
        allow(scope_aware_broadcaster).to receive(:update_subscription) do |q, organization_id:|
          update_subscription_calls << { queue: q, organization_id: organization_id }
        end
        allow(Sse::Broadcaster).to receive(:instance).and_return(scope_aware_broadcaster)

        get "/api/events", params: { token: scoped_token }

        expect(response).to have_http_status(:ok)
        # First payload landed while the viewer was still in org_a — delivered.
        expect(response.body).to include("event: before_change")
        # Second payload popped after the reassignment; refresh picks up
        # org_b and the event_visible_to_scope? check rejects it.
        expect(response.body).not_to include("event: after_change")
        # Producer-side filter must also be updated so future cross-tenant
        # events never reach the queue. Without this assertion, a regression
        # that only updated consumer-side state would silently restore the
        # broadcaster's stale routing for the dominant filter axis.
        expect(update_subscription_calls).to include(
          a_hash_including(queue: mid_stream_queue, organization_id: org_b.id),
        )
      end

      it "wakes the consumer loop for scope refresh via the heartbeat sentinel even when no event payload arrives (Codex P2 starvation fix)" do
        # Codex P2 (2026-04-28): the prior payload-gated A.3 fix only
        # ran the refresh after `queue.pop` returned, so an org
        # reassignment with no in-flight old-scope events left the
        # broadcaster's stale producer-side filter dropping every
        # new-scope event before it reached this queue — under-
        # delivery indefinitely until reconnect.
        #
        # The fix: heartbeat thread now pushes a unique-identity
        # sentinel into the queue on each tick; the loop pops it,
        # always runs the refresh, and skips event delivery for it.
        # This spec proves the sentinel-driven path: the queue NEVER
        # returns a real payload, only the sentinel, and we still
        # see the broadcaster get the new org_id.
        sentinel = Api::EventsController::SCOPE_REFRESH_TICK

        starvation_queue = Class.new do
          def initialize(sentinel, user, new_org)
            @items = [sentinel, nil] # sentinel, then close — no payloads
            @user = user
            @new_org = new_org
            @pop_count = 0
          end
          def pop
            @pop_count += 1
            # Reassign user *before* the sentinel is popped, so the
            # refresh that runs on sentinel arrival picks up the
            # post-reassignment scope. This is the starvation
            # scenario: no old-scope payload ever arrives — the
            # heartbeat sentinel is the only wakeup.
            @user.update!(organization: @new_org) if @pop_count == 1
            @items.shift
          end
          def close; end
          def closed?; @items.empty?; end
        end.new(sentinel, scoped_user, org_b)

        update_subscription_calls = []
        scope_aware_broadcaster = instance_double(
          Sse::Broadcaster,
          subscribe: starvation_queue,
          unsubscribe: nil,
        )
        allow(scope_aware_broadcaster).to receive(:update_subscription) do |q, organization_id:|
          update_subscription_calls << { queue: q, organization_id: organization_id }
        end
        allow(Sse::Broadcaster).to receive(:instance).and_return(scope_aware_broadcaster)

        get "/api/events", params: { token: scoped_token }

        expect(response).to have_http_status(:ok)
        # The connected event is the only event the client receives
        # — the sentinel must NOT have been written as an event,
        # since it carries no payload (and identity-equality with
        # SCOPE_REFRESH_TICK would not survive JSON.parse anyway).
        expect(response.body).to include("event: connected")
        # Critical: the sentinel was treated as a wakeup, not an
        # event. No spurious event:* lines beyond connected.
        expect(response.body.scan(/^event: (\w+)/).flatten - %w[connected])
          .to be_empty
        # Critical: the refresh ran on sentinel arrival even though
        # no event payload was ever pushed by the broadcaster, and
        # the new org_id reached the broadcaster.
        expect(update_subscription_calls).to include(
          a_hash_including(queue: starvation_queue, organization_id: org_b.id),
        )
      end

      it "closes the stream when the user record is deleted mid-stream" do
        stub_const("Api::EventsController::USER_SCOPE_REFRESH_SECONDS", 0)

        payloads = [
          enqueue_event(event: "before_delete", organization_id: org_a.id),
          enqueue_event(event: "after_delete",  organization_id: org_a.id),
        ]
        delete_aware_queue = Class.new do
          def initialize(payloads, user)
            @payloads = payloads.dup
            @user = user
            @pop_count = 0
          end
          def pop
            @pop_count += 1
            @user.destroy! if @pop_count == 2
            @payloads.shift
          end
          def close; end
          def closed?; @payloads.empty?; end
        end.new(payloads, scoped_user)

        broadcaster_double = instance_double(
          Sse::Broadcaster,
          subscribe: delete_aware_queue,
          unsubscribe: nil,
          update_subscription: nil,
        )
        allow(Sse::Broadcaster).to receive(:instance).and_return(broadcaster_double)

        get "/api/events", params: { token: scoped_token }

        expect(response).to have_http_status(:ok)
        # First event was delivered before the deletion took effect.
        expect(response.body).to include("event: before_delete")
        # The deletion is detected on the second iteration's refresh and
        # the loop breaks before the second event is delivered.
        expect(response.body).not_to include("event: after_delete")
        expect(broadcaster_double).to have_received(:unsubscribe).with(delete_aware_queue)
      end
    end
  end
end
