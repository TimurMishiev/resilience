require "rails_helper"

RSpec.describe "Api::SignalRuleMatches", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:user) { create(:user) }

  let(:site_a)   { create(:site) }
  let(:site_b)   { create(:site) }
  let(:rule_a)   { create(:correlation_rule, name: "Rule A") }
  let(:rule_b)   { create(:correlation_rule, name: "Rule B") }

  let!(:match1) do
    create(:signal_rule_match,
           site: site_a, correlation_rule: rule_a,
           fired_at: 2.hours.ago)
  end
  let!(:match2) do
    create(:signal_rule_match,
           site: site_b, correlation_rule: rule_b,
           fired_at: 30.minutes.ago)
  end
  let!(:match3) do
    create(:signal_rule_match,
           site: site_a, correlation_rule: rule_b,
           fired_at: 10.minutes.ago)
  end

  describe "GET /api/signal_rule_matches" do
    it "returns 200 with data array and pagination meta" do
      get "/api/signal_rule_matches", headers: auth_headers(user)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["data"]).to be_an(Array)
      expect(body["meta"]).to include("total", "page", "per_page", "total_pages")
    end

    it "returns all matches ordered by fired_at desc" do
      get "/api/signal_rule_matches", headers: auth_headers(user)
      body = JSON.parse(response.body)
      expect(body["meta"]["total"]).to eq(3)
      times = body["data"].map { |m| m["fired_at"] }
      expect(times).to eq(times.sort.reverse)
    end

    it "returns expected fields on each record" do
      get "/api/signal_rule_matches", headers: auth_headers(user)
      m = JSON.parse(response.body)["data"].first
      expect(m.keys).to include("id", "fired_at", "metadata", "signal", "correlation_rule", "site", "task")
    end

    it "nests associated signal with key fields" do
      get "/api/signal_rule_matches", headers: auth_headers(user)
      m = JSON.parse(response.body)["data"].first
      expect(m["signal"].keys).to include("id", "source", "signal_type", "lat", "lng")
    end

    it "nests associated correlation_rule with id and name" do
      get "/api/signal_rule_matches", headers: auth_headers(user)
      m = JSON.parse(response.body)["data"].first
      expect(m["correlation_rule"].keys).to include("id", "name")
    end

    it "nests associated site with id and name" do
      get "/api/signal_rule_matches", headers: auth_headers(user)
      m = JSON.parse(response.body)["data"].first
      expect(m["site"].keys).to include("id", "name")
    end

    it "filters by rule_id" do
      get "/api/signal_rule_matches", params: { rule_id: rule_a.id }, headers: auth_headers(user)
      ids = JSON.parse(response.body)["data"].map { |m| m["id"] }
      expect(ids).to contain_exactly(match1.id)
    end

    it "filters by site_id" do
      get "/api/signal_rule_matches", params: { site_id: site_a.id }, headers: auth_headers(user)
      ids = JSON.parse(response.body)["data"].map { |m| m["id"] }
      expect(ids).to contain_exactly(match1.id, match3.id)
    end

    it "filters by signal_id" do
      target_signal = match2.signal
      get "/api/signal_rule_matches", params: { signal_id: target_signal.id }, headers: auth_headers(user)
      ids = JSON.parse(response.body)["data"].map { |m| m["id"] }
      expect(ids).to contain_exactly(match2.id)
    end

    it "filters by from datetime" do
      from = 1.hour.ago.iso8601
      get "/api/signal_rule_matches", params: { from: from }, headers: auth_headers(user)
      ids = JSON.parse(response.body)["data"].map { |m| m["id"] }
      expect(ids).to include(match2.id, match3.id)
      expect(ids).not_to include(match1.id)
    end

    it "returns 400 for an invalid from datetime" do
      get "/api/signal_rule_matches", params: { from: "not-a-datetime" }, headers: auth_headers(user)

      expect(response).to have_http_status(:bad_request)
      expect(JSON.parse(response.body)).to eq(
        "errors" => ["Invalid 'from' datetime"]
      )
    end

    it "filters by to datetime" do
      to = 1.hour.ago.iso8601
      get "/api/signal_rule_matches", params: { to: to }, headers: auth_headers(user)
      ids = JSON.parse(response.body)["data"].map { |m| m["id"] }
      expect(ids).to contain_exactly(match1.id)
    end

    it "returns 400 for an invalid to datetime" do
      get "/api/signal_rule_matches", params: { to: "not-a-datetime" }, headers: auth_headers(user)

      expect(response).to have_http_status(:bad_request)
      expect(JSON.parse(response.body)).to eq(
        "errors" => ["Invalid 'to' datetime"]
      )
    end

    it "requires authentication" do
      get "/api/signal_rule_matches"
      expect(response).to have_http_status(:unauthorized)
    end

    it "reconstructs workflow_status at as_of for replay queries" do
      replay_match = create(:signal_rule_match,
                            site: site_a, correlation_rule: rule_b,
                            fired_at: 40.minutes.ago)

      travel_to 20.minutes.ago do
        Alerts::TransitionService.call(
          match: replay_match,
          to_status: "acknowledged",
          actor: user,
        )
      end

      get "/api/signal_rule_matches",
          params: { as_of: 30.minutes.ago.iso8601, workflow_status: "unacknowledged" },
          headers: auth_headers(user)

      body = JSON.parse(response.body)
      ids = body["data"].map { |m| m["id"] }
      expect(ids).to include(replay_match.id)

      replay_payload = body["data"].find { |m| m["id"] == replay_match.id }
      expect(replay_payload["workflow_status"]).to eq("unacknowledged")
      expect(replay_payload["acknowledged_at"]).to be_nil
    end

    context "geofence_breach filter" do
      let!(:breach_match) do
        create(:signal_rule_match,
               site: site_a, correlation_rule: nil,
               fired_at: 5.minutes.ago,
               metadata: { geofence_breach: true, distance_km: 12.5,
                           signal_type: "vessel_position", signal_source: "ais" })
      end

      it "returns only geofence breach matches when geofence_breach=true" do
        get "/api/signal_rule_matches", params: { geofence_breach: true }, headers: auth_headers(user)
        ids = JSON.parse(response.body)["data"].map { |m| m["id"] }
        expect(ids).to contain_exactly(breach_match.id)
      end

      it "excludes geofence breach matches when geofence_breach=false" do
        get "/api/signal_rule_matches", params: { geofence_breach: false }, headers: auth_headers(user)
        ids = JSON.parse(response.body)["data"].map { |m| m["id"] }
        expect(ids).to include(match1.id, match2.id, match3.id)
        expect(ids).not_to include(breach_match.id)
      end
    end
  end

  describe "GET /api/signal_rule_matches/active_breach_sites" do
    let!(:breach_match) do
      create(:signal_rule_match,
             site: site_a, correlation_rule: nil,
             fired_at: 5.minutes.ago,
             metadata: { geofence_breach: true, distance_km: 8.2,
                         signal_type: "vessel_position", signal_source: "ais" })
    end
    let!(:acked_breach) do
      create(:signal_rule_match,
             site: site_b, correlation_rule: nil,
             fired_at: 10.minutes.ago,
             workflow_status: "acknowledged",
             metadata: { geofence_breach: true, distance_km: 3.1,
                         signal_type: "aircraft_position", signal_source: "opensky" })
    end

    it "returns only site IDs with unacknowledged geofence breaches" do
      get "/api/signal_rule_matches/active_breach_sites", headers: auth_headers(user)
      expect(response).to have_http_status(:ok)
      ids = JSON.parse(response.body)["site_ids"]
      expect(ids).to include(site_a.id)
      expect(ids).not_to include(site_b.id) # acknowledged breach excluded
    end

    it "never includes regular rule-fire matches" do
      get "/api/signal_rule_matches/active_breach_sites", headers: auth_headers(user)
      ids = JSON.parse(response.body)["site_ids"]
      # match1/match2/match3 are plain rule fires with no geofence_breach metadata
      expect(ids).not_to include(match2.site_id)
    end

    it "returns 401 for unauthenticated requests" do
      get "/api/signal_rule_matches/active_breach_sites"
      expect(response).to have_http_status(:unauthorized)
    end

    it "reconstructs active breach site IDs historically as_of" do
      replay_breach = create(
        :signal_rule_match,
        site: site_b,
        correlation_rule: nil,
        fired_at: 40.minutes.ago,
        metadata: { geofence_breach: true, distance_km: 5.0,
                    signal_type: "vessel_position", signal_source: "ais" }
      )

      travel_to 20.minutes.ago do
        Alerts::TransitionService.call(
          match: replay_breach,
          to_status: "acknowledged",
          actor: user,
        )
      end

      get "/api/signal_rule_matches/active_breach_sites",
          params: { as_of: 30.minutes.ago.iso8601 },
          headers: auth_headers(user)

      expect(response).to have_http_status(:ok)
      ids = JSON.parse(response.body)["site_ids"]
      expect(ids).to include(site_b.id)
    end
  end

  describe "GET /api/signal_rule_matches/active_site_confidence" do
    let!(:site_c) { create(:site) }

    let!(:active_low) do
      create(:signal_rule_match,
             site: site_a, correlation_rule: rule_a,
             fired_at: 8.minutes.ago,
             confidence: 0.40)
    end
    let!(:active_high) do
      create(:signal_rule_match,
             site: site_a, correlation_rule: rule_a,
             fired_at: 4.minutes.ago,
             confidence: 0.85)
    end
    let!(:active_other_site) do
      # Above the default factory confidence (0.8) so we provably beat the
      # file-wide `match2` on site_b without depending on factory internals.
      create(:signal_rule_match,
             site: site_b, correlation_rule: rule_b,
             fired_at: 6.minutes.ago,
             confidence: 0.92)
    end
    let!(:closed_higher) do
      create(:signal_rule_match,
             site: site_c, correlation_rule: rule_b,
             fired_at: 7.minutes.ago,
             workflow_status: "closed",
             confidence: 0.95)
    end
    let!(:closed_low_with_active_match_on_same_site) do
      create(:signal_rule_match,
             site: site_b, correlation_rule: rule_b,
             fired_at: 9.minutes.ago,
             workflow_status: "closed",
             confidence: 0.99)
    end
    let!(:nil_site_match) do
      # Tasks-only match (no site, no incident) — site_id nil; must be dropped.
      task = create(:task)
      create(:signal_rule_match,
             site: nil, incident: nil, task: task,
             correlation_rule: rule_a,
             fired_at: 5.minutes.ago,
             confidence: 0.77)
    end

    it "returns one summary per active site with the max confidence" do
      get "/api/signal_rule_matches/active_site_confidence", headers: auth_headers(user)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body.keys).to contain_exactly("summaries")
      summaries = body["summaries"]

      site_ids = summaries.map { |s| s["site_id"] }
      expect(site_ids).to contain_exactly(site_a.id, site_b.id)

      by_site = summaries.index_by { |s| s["site_id"] }
      expect(by_site[site_a.id]["confidence"]).to be_within(1e-6).of(0.85)
      # site_b's max active match is 0.92; its 0.99 closed match must not win.
      expect(by_site[site_b.id]["confidence"]).to be_within(1e-6).of(0.92)
    end

    it "excludes sites whose only matches are closed" do
      get "/api/signal_rule_matches/active_site_confidence", headers: auth_headers(user)
      site_ids = JSON.parse(response.body)["summaries"].map { |s| s["site_id"] }
      expect(site_ids).not_to include(site_c.id)
    end

    it "drops nil site_ids" do
      get "/api/signal_rule_matches/active_site_confidence", headers: auth_headers(user)
      summaries = JSON.parse(response.body)["summaries"]
      expect(summaries.map { |s| s["site_id"] }).to all(be_present)
    end

    it "is unpaginated (no meta envelope, returns all active sites in one response)" do
      get "/api/signal_rule_matches/active_site_confidence", headers: auth_headers(user)
      body = JSON.parse(response.body)
      expect(body).not_to have_key("meta")
      expect(body).not_to have_key("data")
    end

    it "returns 401 for unauthenticated requests" do
      get "/api/signal_rule_matches/active_site_confidence"
      expect(response).to have_http_status(:unauthorized)
    end

    it "reconstructs active site confidence as_of (replay closed-collapse)" do
      replay_match = create(
        :signal_rule_match,
        site: site_c, correlation_rule: rule_a,
        fired_at: 40.minutes.ago,
        confidence: 0.72
      )

      travel_to 20.minutes.ago do
        Alerts::TransitionService.call(
          match: replay_match,
          to_status: "acknowledged",
          actor: user,
        )
      end

      get "/api/signal_rule_matches/active_site_confidence",
          params: { as_of: 30.minutes.ago.iso8601 },
          headers: auth_headers(user)

      expect(response).to have_http_status(:ok)
      summaries = JSON.parse(response.body)["summaries"]
      site_c_row = summaries.find { |s| s["site_id"] == site_c.id }
      expect(site_c_row).not_to be_nil
      expect(site_c_row["confidence"]).to be_within(1e-6).of(0.72)
    end
  end

  # ── A.2 fix: bounded-memory replay reduction ────────────────────────────────
  # The replay branches of active_breach_sites and active_site_confidence
  # previously called `.to_a` on the full historical match set up to `as_of`
  # and then ran `Replay::StateSerializer.match_states(full_set, ...)` over
  # the entire materialization. At production-tenant scale (months of history,
  # 10k+ matches), that path peaked memory at O(matches + audit_events)
  # simultaneously held in Ruby. The fix replaces the `.to_a` with
  # `find_in_batches(batch_size: REPLAY_BATCH_SIZE)`, calling the serializer
  # once per batch and aggregating cross-batch in O(unique sites) memory.
  #
  # These specs prove the contract: StateSerializer is never invoked with
  # more than REPLAY_BATCH_SIZE matches at a time, regardless of how many
  # historical matches exist. We stub the constant down to a small value
  # so we can create a representative test fixture without the cost of
  # creating 500+ records, then assert the batching behavior holds.
  describe "A.2 — bounded-memory replay reduction" do
    let(:test_batch_size) { 2 }
    let(:replay_user)     { user }
    let(:as_of)           { 5.minutes.ago }

    before do
      stub_const("Api::SignalRuleMatchesController::REPLAY_BATCH_SIZE", test_batch_size)
    end

    it "calls StateSerializer.match_states in bounded batches for active_site_confidence" do
      # 5 matches across 3 sites, all fired_at within the replay window.
      # File-level let!(:match1/2/3) also contribute (they have site_id
      # set and fall within the as_of window), bringing the total to 8.
      # With batch_size = 2, we expect ceil(8/2) = 4 calls and the max
      # per-call size never exceeds the batch bound.
      sites = Array.new(3) { create(:site) }
      create(:signal_rule_match, site: sites[0], correlation_rule: rule_a,
                                 fired_at: 30.minutes.ago, confidence: 0.40)
      create(:signal_rule_match, site: sites[0], correlation_rule: rule_a,
                                 fired_at: 25.minutes.ago, confidence: 0.85)
      create(:signal_rule_match, site: sites[1], correlation_rule: rule_b,
                                 fired_at: 20.minutes.ago, confidence: 0.55)
      create(:signal_rule_match, site: sites[2], correlation_rule: rule_b,
                                 fired_at: 15.minutes.ago, confidence: 0.70)
      create(:signal_rule_match, site: sites[2], correlation_rule: rule_a,
                                 fired_at: 10.minutes.ago, confidence: 0.95)

      observed_batch_sizes = []
      original_match_states = Replay::StateSerializer.method(:match_states)
      allow(Replay::StateSerializer).to receive(:match_states) do |batch, **kwargs|
        observed_batch_sizes << batch.size
        original_match_states.call(batch, **kwargs)
      end

      get "/api/signal_rule_matches/active_site_confidence",
          params: { as_of: as_of.iso8601 },
          headers: auth_headers(replay_user)

      expect(response).to have_http_status(:ok)
      # The load-bearing assertion: NO single batch ever exceeds the bound.
      # Match count + batch count are derived; the bound is the contract.
      expect(observed_batch_sizes.max).to be <= test_batch_size
      # Multiple batches must be produced — proves we're actually batching
      # rather than accidentally falling back to one big call.
      expect(observed_batch_sizes.size).to be > 1
      # Total matches across batches must equal the controller-visible
      # input set (5 created here + 3 file-level fixtures = 8).
      expect(observed_batch_sizes.sum).to eq(8)

      # Output correctness: max(confidence) per active site, preserved
      # across batch boundaries. Sites 0/1/2 should each appear with the
      # correct max from the matches we created (file-level matches use
      # site_a/site_b, separate from sites[0..2]).
      summaries = JSON.parse(response.body)["summaries"]
      by_site = summaries.index_by { |row| row["site_id"] }
      expect(by_site[sites[0].id]["confidence"]).to be_within(1e-6).of(0.85)
      expect(by_site[sites[1].id]["confidence"]).to be_within(1e-6).of(0.55)
      expect(by_site[sites[2].id]["confidence"]).to be_within(1e-6).of(0.95)
    end

    it "calls StateSerializer.match_states in bounded batches for active_breach_sites" do
      site_x = create(:site)
      site_y = create(:site)
      # 4 unacknowledged geofence breach matches; with batch_size = 2
      # we expect 2 calls of 2 each.
      4.times do |i|
        create(:signal_rule_match,
               site: i.even? ? site_x : site_y,
               correlation_rule: nil,
               fired_at: (20 - i).minutes.ago,
               metadata: { geofence_breach: true, distance_km: 5.0 + i,
                           signal_type: "vessel_position", signal_source: "ais" })
      end

      observed_batch_sizes = []
      original_match_states = Replay::StateSerializer.method(:match_states)
      allow(Replay::StateSerializer).to receive(:match_states) do |batch, **kwargs|
        observed_batch_sizes << batch.size
        original_match_states.call(batch, **kwargs)
      end

      get "/api/signal_rule_matches/active_breach_sites",
          params: { as_of: as_of.iso8601 },
          headers: auth_headers(replay_user)

      expect(response).to have_http_status(:ok)
      expect(observed_batch_sizes.size).to eq(2)
      expect(observed_batch_sizes.max).to be <= test_batch_size
      expect(observed_batch_sizes.sum).to eq(4)

      # Output correctness: site_x and site_y both have unacknowledged
      # breaches, so both should appear once (uniq'd) regardless of
      # batch boundary.
      site_ids = JSON.parse(response.body)["site_ids"]
      expect(site_ids).to contain_exactly(site_x.id, site_y.id)
    end
  end

  describe "GET /api/signal_rule_matches/:id" do
    it "returns 200 with the match and associations" do
      get "/api/signal_rule_matches/#{match1.id}", headers: auth_headers(user)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["id"]).to eq(match1.id)
      expect(body["correlation_rule"]["name"]).to eq("Rule A")
      expect(body["site"]["id"]).to eq(site_a.id)
    end

    it "returns 404 for unknown UUID" do
      get "/api/signal_rule_matches/#{SecureRandom.uuid}", headers: auth_headers(user)
      expect(response).to have_http_status(:not_found)
    end

    it "replays historical rule and site context and hides future tasks as_of" do
      replay_site = create(:site, name: "Site Alpha")
      replay_rule = create(:correlation_rule, name: "Rule Alpha")
      future_task = create(:task, site: replay_site, title: "Future task")
      replay_match = create(
        :signal_rule_match,
        site: replay_site,
        correlation_rule: replay_rule,
        task: future_task,
        fired_at: 40.minutes.ago
      )

      create(:audit_event,
        actor: "system",
        entity_type: "Site",
        entity_id: replay_site.id,
        event_type: "site.created",
        action: "create",
        before_snapshot: nil,
        after_snapshot: {
          name: "Site Alpha",
        },
        occurred_at: 2.hours.ago,
        correlation_id: SecureRandom.uuid,
      )
      create(:audit_event,
        actor: "system",
        entity_type: "CorrelationRule",
        entity_id: replay_rule.id,
        event_type: "correlation_rule.created",
        action: "create",
        before_snapshot: nil,
        after_snapshot: {
          name: "Rule Alpha",
        },
        occurred_at: 2.hours.ago,
        correlation_id: SecureRandom.uuid,
      )

      travel_to 20.minutes.ago do
        replay_site.update!(name: "Site Renamed")
        replay_rule.update!(name: "Rule Renamed")

        create(:audit_event,
          actor: "system",
          entity_type: "Site",
          entity_id: replay_site.id,
          event_type: "site.updated",
          action: "update",
          before_snapshot: {
            name: "Site Alpha",
          },
          after_snapshot: {
            name: "Site Renamed",
          },
          occurred_at: Time.current,
          correlation_id: SecureRandom.uuid,
        )
        create(:audit_event,
          actor: "system",
          entity_type: "CorrelationRule",
          entity_id: replay_rule.id,
          event_type: "correlation_rule.updated",
          action: "update",
          before_snapshot: {
            name: "Rule Alpha",
          },
          after_snapshot: {
            name: "Rule Renamed",
          },
          occurred_at: Time.current,
          correlation_id: SecureRandom.uuid,
        )
      end

      create(:audit_event,
        actor: "system",
        entity_type: "Task",
        entity_id: future_task.id,
        event_type: "task.created",
        action: "create",
        before_snapshot: nil,
        after_snapshot: future_task.attributes.except("updated_at"),
        occurred_at: 15.minutes.ago,
        correlation_id: SecureRandom.uuid,
      )

      get "/api/signal_rule_matches/#{replay_match.id}",
          params: { as_of: 30.minutes.ago.iso8601 },
          headers: auth_headers(user)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body.dig("site", "name")).to eq("Site Alpha")
      expect(body.dig("correlation_rule", "name")).to eq("Rule Alpha")
      expect(body["task"]).to be_nil
    end
  end

  describe "POST /api/signal_rule_matches/bulk_transition" do
    it "transitions all supplied matches to the requested status" do
      post "/api/signal_rule_matches/bulk_transition",
           params:  { ids: [match1.id, match2.id], to_status: "acknowledged" },
           headers: auth_headers(user), as: :json

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["succeeded"].map { |r| r["id"] }).to contain_exactly(match1.id, match2.id)
      expect(body["failed"]).to be_empty
    end

    it "reports the new workflow_status without requiring a per-match reload" do
      # Guards against a regression where removing the in-loop reload left
      # `workflow_status` stale. The service mutates @match in-place, so the
      # controller can read workflow_status directly. A silent pre-reload
      # value ("new") would be caught here.
      post "/api/signal_rule_matches/bulk_transition",
           params:  { ids: [match1.id, match2.id], to_status: "acknowledged" },
           headers: auth_headers(user), as: :json

      body = JSON.parse(response.body)
      expect(body["succeeded"].map { |r| r["workflow_status"] })
        .to contain_exactly("acknowledged", "acknowledged")
    end

    it "reports per-alert failures without aborting the batch" do
      # Close match1 so it cannot be re-acknowledged (invalid transition)
      match1.update_column(:workflow_status, "closed")

      post "/api/signal_rule_matches/bulk_transition",
           params:  { ids: [match1.id, match2.id], to_status: "acknowledged" },
           headers: auth_headers(user), as: :json

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["succeeded"].map { |r| r["id"] }).to contain_exactly(match2.id)
      expect(body["failed"].map { |r| r["id"] }).to contain_exactly(match1.id)
    end

    it "returns 422 when ids or to_status is missing" do
      post "/api/signal_rule_matches/bulk_transition",
           params:  { to_status: "acknowledged" },
           headers: auth_headers(user), as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "returns 401 for unauthenticated requests" do
      post "/api/signal_rule_matches/bulk_transition",
           params: { ids: [match1.id], to_status: "acknowledged" }, as: :json
      expect(response).to have_http_status(:unauthorized)
    end
  end
end
