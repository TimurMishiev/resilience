require "rails_helper"

RSpec.describe RuntimeBudget::Validator do
  # Helper builds a fake connection_pool double — only #size is used.
  def fake_pool(size)
    double("ConnectionPool", size: size)
  end

  describe ".compute — primary pool check" do
    it "computes primary required = puma_threads + LISTEN + headroom" do
      env = { "RAILS_MAX_THREADS" => "20" }
      result = described_class.compute(env: env, primary_pool: fake_pool(25))

      # 20 Puma + 1 LISTEN + 1 headroom = 22
      expect(result.primary_required).to eq(22)
      expect(result.primary_actual).to eq(25)
      expect(result.primary_ok).to be(true)
    end

    it "primary_ok=false when actual is short of required" do
      env = { "RAILS_MAX_THREADS" => "30" }
      result = described_class.compute(env: env, primary_pool: fake_pool(25))

      # 30 + 1 + 1 = 32 required, 25 actual → fails
      expect(result.primary_ok).to be(false)
      expect(result.ok).to be(false)
    end

    it "primary_required is independent of JOB_CONCURRENCY" do
      env_low  = { "RAILS_MAX_THREADS" => "20", "JOB_CONCURRENCY" => "1" }
      env_high = { "RAILS_MAX_THREADS" => "20", "JOB_CONCURRENCY" => "10" }

      low_result  = described_class.compute(env: env_low,  primary_pool: fake_pool(25))
      high_result = described_class.compute(env: env_high, primary_pool: fake_pool(25))

      expect(low_result.primary_required).to eq(high_result.primary_required)
    end

    it "primary_required is independent of SOLID_QUEUE_IN_PUMA" do
      # Closes the Codex P1 finding: pre-fix, the primary pool check
      # included SQ overhead because the validator conflated the two
      # pools. The corrected math separates them; only the queue pool
      # cares about SOLID_QUEUE_IN_PUMA.
      env_in  = { "RAILS_MAX_THREADS" => "20", "SOLID_QUEUE_IN_PUMA" => "true" }
      env_out = { "RAILS_MAX_THREADS" => "20", "SOLID_QUEUE_IN_PUMA" => "false" }

      in_result  = described_class.compute(env: env_in,  primary_pool: fake_pool(25))
      out_result = described_class.compute(env: env_out, primary_pool: fake_pool(25))

      expect(in_result.primary_required).to eq(out_result.primary_required)
    end
  end

  describe ".compute — queue pool check" do
    it "computes queue required = SQ workers + dispatcher + headroom when SOLID_QUEUE_IN_PUMA=true and queue_pool injected" do
      env = {
        "SOLID_QUEUE_IN_PUMA" => "true",
        "RAILS_MAX_THREADS"   => "20",
        "JOB_CONCURRENCY"     => "1",
      }
      result = described_class.compute(
        env: env,
        primary_pool: fake_pool(25),
        queue_pool:   fake_pool(25),
      )

      # (1 × 3) workers + 1 dispatcher + 1 headroom = 5
      expect(result.queue_checked).to be(true)
      expect(result.queue_required).to eq(5)
      expect(result.queue_ok).to be(true)
    end

    it "scales queue_required by JOB_CONCURRENCY" do
      env = {
        "SOLID_QUEUE_IN_PUMA" => "true",
        "RAILS_MAX_THREADS"   => "20",
        "JOB_CONCURRENCY"     => "3",
      }
      result = described_class.compute(
        env: env,
        primary_pool: fake_pool(50),
        queue_pool:   fake_pool(50),
      )

      # (3 × 3) workers + 1 dispatcher + 1 headroom = 11
      expect(result.queue_required).to eq(11)
    end

    it "skips the queue check when SOLID_QUEUE_IN_PUMA is false (separate process owns the queue pool)" do
      env = {
        "SOLID_QUEUE_IN_PUMA" => "false",
        "RAILS_MAX_THREADS"   => "20",
        "JOB_CONCURRENCY"     => "1",
      }
      result = described_class.compute(
        env: env,
        primary_pool: fake_pool(25),
        queue_pool:   fake_pool(2), # would otherwise fail; skipped
      )

      expect(result.queue_checked).to be(false)
      expect(result.queue_ok).to be(true) # vacuously
      expect(result.ok).to be(true)
    end

    it "skips the queue check when queue_pool is not injected even with SOLID_QUEUE_IN_PUMA=true (defensive default)" do
      # The initializer tolerates SolidQueue::Record being absent on
      # boot (e.g. emergency boot scenarios). When we can't see the
      # queue pool we don't false-fail; ADR-011 documents that the
      # queue pool check requires explicit wiring.
      env = {
        "SOLID_QUEUE_IN_PUMA" => "true",
        "RAILS_MAX_THREADS"   => "20",
        "JOB_CONCURRENCY"     => "1",
      }
      result = described_class.compute(env: env, primary_pool: fake_pool(25))

      expect(result.queue_checked).to be(false)
      expect(result.queue_ok).to be(true)
    end

    it "queue_ok=false when SQ workers exceed the queue pool" do
      env = {
        "SOLID_QUEUE_IN_PUMA" => "true",
        "RAILS_MAX_THREADS"   => "20",
        "JOB_CONCURRENCY"     => "5",
      }
      result = described_class.compute(
        env: env,
        primary_pool: fake_pool(25),
        queue_pool:   fake_pool(10),
      )

      # (5 × 3) + 1 + 1 = 17 required, 10 actual → queue fails
      expect(result.queue_ok).to be(false)
      expect(result.ok).to be(false)
    end
  end

  describe ".compute — combined ok flag" do
    it "ok=true when both pools satisfy their requirements" do
      env = {
        "SOLID_QUEUE_IN_PUMA" => "true",
        "RAILS_MAX_THREADS"   => "20",
        "JOB_CONCURRENCY"     => "1",
      }
      result = described_class.compute(env: env, primary_pool: fake_pool(25), queue_pool: fake_pool(25))

      expect(result.primary_ok).to be(true)
      expect(result.queue_ok).to be(true)
      expect(result.ok).to be(true)
    end

    it "ok=false when only the queue pool is short" do
      env = {
        "SOLID_QUEUE_IN_PUMA" => "true",
        "RAILS_MAX_THREADS"   => "20",
        "JOB_CONCURRENCY"     => "10",
      }
      result = described_class.compute(env: env, primary_pool: fake_pool(25), queue_pool: fake_pool(25))

      # primary req 22, actual 25 → primary ok
      # queue req (10 × 3 + 2) = 32, actual 25 → queue not ok
      expect(result.primary_ok).to be(true)
      expect(result.queue_ok).to be(false)
      expect(result.ok).to be(false)
    end

    it "ok=false when only the primary pool is short" do
      env = {
        "SOLID_QUEUE_IN_PUMA" => "true",
        "RAILS_MAX_THREADS"   => "30",
        "JOB_CONCURRENCY"     => "1",
      }
      result = described_class.compute(env: env, primary_pool: fake_pool(25), queue_pool: fake_pool(25))

      expect(result.primary_ok).to be(false)
      expect(result.queue_ok).to be(true)
      expect(result.ok).to be(false)
    end
  end

  describe ".validate!" do
    it "returns the result when both pools are ok" do
      env = { "SOLID_QUEUE_IN_PUMA" => "true", "RAILS_MAX_THREADS" => "20", "JOB_CONCURRENCY" => "1" }
      expect {
        described_class.validate!(env: env, primary_pool: fake_pool(30), queue_pool: fake_pool(30))
      }.not_to raise_error
    end

    it "raises with primary-pool diagnostic when primary is short" do
      env = { "RAILS_MAX_THREADS" => "30" }
      expect {
        described_class.validate!(env: env, primary_pool: fake_pool(10))
      }.to raise_error(
        described_class::InsufficientPoolError,
        a_string_including(
          "Primary pool: have 10, need 32",
          "30 Puma + 1 LISTEN + 1 headroom",
          "DB_POOL",
        ),
      )
    end

    it "raises with queue-pool diagnostic when only the queue is short" do
      env = { "SOLID_QUEUE_IN_PUMA" => "true", "RAILS_MAX_THREADS" => "20", "JOB_CONCURRENCY" => "5" }
      expect {
        described_class.validate!(env: env, primary_pool: fake_pool(25), queue_pool: fake_pool(10))
      }.to raise_error(
        described_class::InsufficientPoolError,
        a_string_including(
          "Queue pool: have 10, need 17",
          "15 SQ workers + 1 dispatcher + 1 headroom",
          "SOLID_QUEUE_IN_PUMA=false",
        ),
      )
    end
  end

  describe ".should_validate?" do
    it "returns true in production with no skip flag" do
      expect(described_class.should_validate?(env: {}, rails_env: "production")).to be(true)
    end

    it "returns false outside production" do
      expect(described_class.should_validate?(env: {}, rails_env: "development")).to be(false)
      expect(described_class.should_validate?(env: {}, rails_env: "test")).to be(false)
    end

    it "returns false when RUNTIME_BUDGET_SKIP is truthy" do
      [ "1", "true", "yes" ].each do |truthy|
        expect(described_class.should_validate?(env: { "RUNTIME_BUDGET_SKIP" => truthy }, rails_env: "production")).to be(false)
      end
    end

    it "returns true when RUNTIME_BUDGET_SKIP is set to a non-truthy value" do
      expect(described_class.should_validate?(env: { "RUNTIME_BUDGET_SKIP" => "0" }, rails_env: "production")).to be(true)
      expect(described_class.should_validate?(env: { "RUNTIME_BUDGET_SKIP" => "false" }, rails_env: "production")).to be(true)
    end
  end

  describe "current production budget (sanity check, ADR-011)" do
    # Mirrors the actual fly.toml env values the production deploy
    # uses today. Both pools currently inherit DB_POOL from the same
    # primary_production YAML anchor, so a single pool size is checked
    # against both requirements. If a future change adds an explicit
    # `pool:` override to the queue: section in database.yml, this
    # spec must be updated to inject distinct pool sizes.
    it "passes with the documented production env (RAILS_MAX_THREADS=20, JOB_CONCURRENCY=1, implicit DB_POOL=25)" do
      env = {
        "SOLID_QUEUE_IN_PUMA" => "true",
        "RAILS_MAX_THREADS"   => "20",
        "JOB_CONCURRENCY"     => "1",
      }
      result = described_class.compute(
        env: env,
        primary_pool: fake_pool(25),  # = RAILS_MAX_THREADS + 5 from database.yml
        queue_pool:   fake_pool(25),
      )

      # primary required = 22, actual = 25 → 3 connections of slack
      # queue   required = 5,  actual = 25 → 20 connections of slack (queue pool inherits primary, oversized)
      expect(result.primary_ok).to be(true)
      expect(result.queue_ok).to be(true)
      expect(result.ok).to be(true)
      expect(result.primary_required).to eq(22)
      expect(result.queue_required).to eq(5)
    end

    it "would fail if a future operator dropped DB_POOL below 22 (regression guard for primary)" do
      env = {
        "SOLID_QUEUE_IN_PUMA" => "true",
        "RAILS_MAX_THREADS"   => "20",
        "JOB_CONCURRENCY"     => "1",
      }
      result = described_class.compute(
        env: env,
        primary_pool: fake_pool(20),
        queue_pool:   fake_pool(20),
      )

      expect(result.primary_ok).to be(false)
      expect(result.primary_required - result.primary_actual).to eq(2)
    end

    it "would fail if JOB_CONCURRENCY was bumped past what the queue pool can absorb" do
      env = {
        "SOLID_QUEUE_IN_PUMA" => "true",
        "RAILS_MAX_THREADS"   => "20",
        "JOB_CONCURRENCY"     => "10",
      }
      result = described_class.compute(
        env: env,
        primary_pool: fake_pool(25),
        queue_pool:   fake_pool(25),
      )

      # queue required = 10 × 3 + 1 + 1 = 32; actual = 25 → fails by 7
      expect(result.queue_ok).to be(false)
      expect(result.queue_required - result.queue_actual).to eq(7)
    end
  end
end
