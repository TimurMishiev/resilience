require "rails_helper"

RSpec.describe Correlations::RuleFiringJob do
  include ActiveSupport::Testing::TimeHelpers

  let(:logger) { instance_double(ActiveSupport::Logger, info: nil, warn: nil, error: nil) }

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
    allow(Rails).to receive(:logger).and_return(logger)
  end

  it "fires when the rule still matches at execution time" do
    expect {
      described_class.perform_now(rule.id, signal.id, site.id)
    }.to change(Task, :count).by(1)
      .and change(SignalRuleMatch, :count).by(1)

    expect(logger).to have_received(:info)
      .with(include(
        "[RuleFiringJob]",
        "outcome=fired",
        "rule=#{rule.id}",
        "signal=#{signal.id}",
        "site=#{site.id}",
        "actions=create_task",
        "attempt=",
      ))
  end

  it "skips when the rule was deactivated after enqueue" do
    rule.update!(is_active: false)

    expect {
      described_class.perform_now(rule.id, signal.id, site.id)
    }.not_to change(Task, :count)

    expect(SignalRuleMatch.count).to eq(0)
    expect(rule.reload.last_fired_at).to be_nil
    expect(logger).to have_received(:info)
      .with(include(
        "[RuleFiringJob]",
        "outcome=revalidation_skipped",
        "rule=#{rule.id}",
        "signal=#{signal.id}",
        "site=#{site.id}",
      ))
  end

  it "skips when the rule conditions changed and the signal no longer matches" do
    rule.update!(conditions: { "signal_type" => "wildfire", "proximity_km" => 100 })

    expect {
      described_class.perform_now(rule.id, signal.id, site.id)
    }.not_to change(Task, :count)

    expect(SignalRuleMatch.count).to eq(0)
    expect(rule.reload.last_fired_at).to be_nil
  end

  it "skips malformed persisted rules with unsupported nested conditions" do
    malformed_rule = build(:correlation_rule,
      conditions: {
        "operator" => "AND",
        "conditions" => [
          { "signal_type" => "seismic_event", "proximity_km" => 100 },
          { "operator" => "OR", "conditions" => [] }
        ]
      },
      actions: { "create_task" => { "title" => "Alert near {{site_name}}", "priority" => "high" } })
    malformed_rule.save!(validate: false)

    expect {
      described_class.perform_now(malformed_rule.id, signal.id, site.id)
    }.not_to change(Task, :count)

    expect(SignalRuleMatch.count).to eq(0)
    expect(malformed_rule.reload.last_fired_at).to be_nil
    expect(logger).to have_received(:warn)
      .with(include(
        "[EvaluatorService]",
        "outcome=unsupported_condition_shape",
        "rule=#{malformed_rule.id}",
        "signal=#{signal.id}",
      ))
    expect(logger).to have_received(:info)
      .with(include(
        "[RuleFiringJob]",
        "outcome=revalidation_skipped",
        "rule=#{malformed_rule.id}",
        "signal=#{signal.id}",
        "site=#{site.id}",
      ))
  end

  it "logs a structured missing-record outcome" do
    described_class.perform_now(rule.id, SecureRandom.uuid, site.id)

    expect(logger).to have_received(:warn)
      .with(include(
        "[RuleFiringJob]",
        "outcome=missing_records",
        "rule=#{rule.id}",
        "site=#{site.id}",
      ))
  end

  it "logs a structured failed outcome when firing fails unexpectedly" do
    allow(Correlations::RuleFiringService).to receive(:call)
      .and_return(ServiceResult.failure(errors: ["boom"]))

    expect {
      described_class.perform_now(rule.id, signal.id, site.id)
    }.to raise_error(RuntimeError, /\[RuleFiringJob\] Rule firing failed: boom/)

    expect(logger).to have_received(:error)
      .with(include(
        "[RuleFiringJob]",
        "outcome=failed",
        "rule=#{rule.id}",
        "signal=#{signal.id}",
        "site=#{site.id}",
        "error_message=\"boom\"",
      ))
  end

  it "logs a structured cooldown outcome when another worker already claimed the slot" do
    allow(Correlations::RuleFiringService).to receive(:call)
      .and_return(ServiceResult.failure(errors: ["cooldown"]))

    expect {
      described_class.perform_now(rule.id, signal.id, site.id)
    }.not_to change(Task, :count)

    expect(logger).to have_received(:info)
      .with(include(
        "[RuleFiringJob]",
        "outcome=cooldown_skipped",
        "rule=#{rule.id}",
        "signal=#{signal.id}",
        "site=#{site.id}",
      ))
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
