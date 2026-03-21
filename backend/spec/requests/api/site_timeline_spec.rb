require "rails_helper"

RSpec.describe "Api::Sites#timeline", type: :request do
  let(:current_user) { create(:user, :commander) }
  let(:site)         { create(:site, latitude: 26.5, longitude: 56.2) }

  describe "GET /api/sites/:id/timeline" do
    context "with valid credentials" do
      it "returns 200" do
        get "/api/sites/#{site.id}/timeline", headers: auth_headers(current_user)
        expect(response).to have_http_status(:ok)
      end

      it "returns data array and meta" do
        get "/api/sites/#{site.id}/timeline", headers: auth_headers(current_user)
        body = JSON.parse(response.body)
        expect(body).to have_key("data")
        expect(body).to have_key("meta")
        expect(body["data"]).to be_an(Array)
        expect(body["meta"]["site_id"]).to eq(site.id)
      end

      it "includes signal_detected events for nearby signals" do
        create(:external_signal, lat: 26.6, lng: 56.2, occurred_at: 1.day.ago)
        get "/api/sites/#{site.id}/timeline", headers: auth_headers(current_user)
        kinds = JSON.parse(response.body)["data"].map { |e| e["event_kind"] }
        expect(kinds).to include("signal_detected")
      end

      it "includes rule_fired events for this site" do
        create(:signal_rule_match, site: site, fired_at: 2.hours.ago)
        get "/api/sites/#{site.id}/timeline", headers: auth_headers(current_user)
        kinds = JSON.parse(response.body)["data"].map { |e| e["event_kind"] }
        expect(kinds).to include("rule_fired")
      end

      it "respects the kinds filter" do
        create(:external_signal, lat: 26.6, lng: 56.2, occurred_at: 1.day.ago)
        create(:signal_rule_match, site: site, fired_at: 2.hours.ago)
        get "/api/sites/#{site.id}/timeline",
            params:  { kinds: [ "rule_fired" ] },
            headers: auth_headers(current_user)
        kinds = JSON.parse(response.body)["data"].map { |e| e["event_kind"] }.uniq
        expect(kinds).to eq([ "rule_fired" ])
      end

      it "respects the days parameter" do
        create(:external_signal, lat: 26.6, lng: 56.2, occurred_at: 20.days.ago)
        get "/api/sites/#{site.id}/timeline",
            params:  { days: 3 },
            headers: auth_headers(current_user)
        body = JSON.parse(response.body)
        expect(body["meta"]["days"]).to eq(3)
        expect(body["data"].select { |e| e["event_kind"] == "signal_detected" }).to be_empty
      end

      it "rejects invalid kind values silently (only known kinds pass)" do
        get "/api/sites/#{site.id}/timeline",
            params:  { kinds: [ "rule_fired", "INVALID_KIND" ] },
            headers: auth_headers(current_user)
        expect(response).to have_http_status(:ok)
      end
    end

    context "without authentication" do
      it "returns 401" do
        get "/api/sites/#{site.id}/timeline"
        expect(response).to have_http_status(:unauthorized)
      end
    end

    context "with unknown site id" do
      it "returns 404" do
        get "/api/sites/00000000-0000-0000-0000-000000000000/timeline",
            headers: auth_headers(current_user)
        expect(response).to have_http_status(:not_found)
      end
    end
  end
end
