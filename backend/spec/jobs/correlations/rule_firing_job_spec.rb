require "rails_helper"

RSpec.describe Correlations::RuleFiringJob do
  include ActiveSupport::Testing::TimeHelpers

  let(:site) do
    create(:site, name: "Site Alpha", latitude: 51.5, longitude: 0.0, status: "active")
  end
  let(:signal) do
    create(:external_signal, lat: 51.5, lng: 0.1, signal_type: "seismic_event", source: "usgs_seismic")
  end
  let(:rule) do
    create(:correlation_rule,
           name: "Seismic Alert",
           conditions: { "signal_type" => "seismic_event", "proximity_km" => 100 },
           actions:    { "create_task" => { "title" => "Alert near {{site_name}}", "priority" => "high" } })
  end

  before do
    allow(Sse::Broadcaster.instance).to receive(:publish)
    allow(Incidents::FusionService).to receive(:call)
  end

  it "fires when the rule still matches at execution time" do
    expect {
      described_class.perform_now(rule.id, signal.id, site.id)
    }.to change(Task, :count).by(1)
      .and change(SignalRuleMatch, :count).by(1)
  end

  it "skips when the rule was deactivated after enqueue" do
    rule.update!(is_active: false)

    expect {
      described_class.perform_now(rule.id, signal.id, site.id)
    }.not_to change(Task, :count)

    expect(SignalRuleMatch.count).to eq(0)
    expect(rule.reload.last_fired_at).to be_nil
  end

  it "skips when the rule conditions changed and the signal no longer matches" do
    rule.update!(conditions: { "signal_type" => "wildfire", "proximity_km" => 100 })

    expect {
      described_class.perform_now(rule.id, signal.id, site.id)
    }.not_to change(Task, :count)

    expect(SignalRuleMatch.count).to eq(0)
    expect(rule.reload.last_fired_at).to be_nil
  end

  it "fires when execution is delayed but the original signal-time window still matched" do
    base_time = Time.zone.parse("2026-03-26 12:00:00 UTC")

    travel_to(base_time)
    begin
      create(:external_signal,
             lat: 51.5, lng: 0.05,
             signal_type: "seismic_event",
             source: "usgs_seismic",
             occurred_at: 30.minutes.ago)

      delayed_signal = create(:external_signal,
                              lat: 51.5, lng: 0.1,
                              signal_type: "seismic_event",
                              source: "usgs_seismic",
                              occurred_at: Time.current)

      delayed_rule = create(:correlation_rule,
                            name: "Windowed Seismic Alert",
                            conditions: {
                              "signal_type" => "seismic_event",
                              "proximity_km" => 100,
                              "count_threshold" => 2,
                              "time_window_minutes" => 60,
                            },
                            actions: { "create_task" => { "title" => "Alert near {{site_name}}", "priority" => "high" } })

      travel_to(base_time + 2.hours)

      expect {
        described_class.perform_now(delayed_rule.id, delayed_signal.id, site.id)
      }.to change(Task, :count).by(1)
        .and change(SignalRuleMatch, :count).by(1)
    ensure
      travel_back
    end
  end
end
