module Ai
  # Drives the live-model AI evaluation lane. Hits the real Anthropic
  # API for each model-call surface, captures latency / tokens /
  # estimated cost via Ai::AnthropicClient → Metrics::Recorder, and
  # writes a JSON artifact + GITHUB_STEP_SUMMARY markdown.
  #
  # Lives under lib/ (not app/) because it is a CI-only utility and
  # has no production caller. The rake task in
  # lib/tasks/ai_evals.rake is its only caller; specs require this
  # file directly.
  class EvalsRunner
    SURFACES = %w[task_filter signal_filter ontology_query summary].freeze

    ContractFailure = Class.new(StandardError)

    def initialize
      @results_dir = ENV.fetch(
        "AI_EVALS_RESULTS_DIR",
        Rails.root.join("tmp", "ai_evals_live").to_s,
      )
      FileUtils.mkdir_p(@results_dir)
      @timestamp = Time.current.utc.strftime("%Y-%m-%dT%H-%M-%SZ")
      @results = []
    end

    # Returns the exit status (0 = success, 1 = at least one surface
    # failed). Caller decides whether to translate that into an exit
    # code; specs prefer to assert on the return value directly.
    def run!
      Metrics::Recorder.reset!

      user = pick_commander
      site = pick_site_for(user)
      raise "No commander or site available — run rails db:seed first" unless user && site

      run_filter(user, site)
      run_signal_filter(user, site)
      run_ontology_query(user, site)
      run_summary(user, site)

      Metrics::Recorder.snapshot!
      usage_payload = OperationalStatus.find_by(category: "metrics", key: "ai_usage")&.payload || {}

      write_json(usage_payload)
      write_summary(usage_payload)

      failed = @results.count { |r| r[:status] != "success" }
      if failed.positive?
        warn "[ai:live_evals] #{failed}/#{@results.size} surfaces failed"
        return 1
      end

      puts "[ai:live_evals] all #{@results.size} surfaces succeeded"
      0
    end

    private

    def pick_commander
      User.where(role: "commander").first || User.first
    end

    def pick_site_for(user)
      scope = Site.all
      scope = scope.where(organization_id: user.organization_id) if user&.organization_id
      scope.first
    end

    def run_filter(user, site)
      record_surface("task_filter") do
        query  = "show high priority tasks at #{site.name}"
        result = Ai::FilterService.call(user: user, query: query)
        contract_check(result, "filters") { |data| data[:filters].is_a?(Hash) }
        { query: query, output: result.payload[:filters] }
      end
    end

    def run_signal_filter(user, site)
      record_surface("signal_filter") do
        query  = "show GPS jamming signals near #{site.name} in the last 24 hours"
        result = Ai::SignalFilterService.call(user: user, query: query)
        contract_check(result, "filters") { |data| data[:filters].is_a?(Hash) }
        { query: query, output: result.payload[:filters] }
      end
    end

    def run_ontology_query(user, site)
      record_surface("ontology_query") do
        query  = "what is connected to #{site.name}?"
        result = Ai::OntologyQueryService.call(user: user, query: query)
        contract_check(result, "nodes") { |data| data[:nodes].is_a?(Array) && data[:nodes].any? }
        {
          query: query,
          output: { node_count: result.payload[:counts][:node_count], edge_count: result.payload[:counts][:edge_count] },
        }
      end
    end

    def run_summary(user, site)
      record_surface("summary") do
        result = Ai::SummaryService.call(
          user:         user,
          summary_type: "site_activity",
          site_id:      site.id,
        )
        contract_check(result, "summary") { |data| data[:summary].is_a?(String) && data[:summary].length.positive? }
        {
          site:    site.name,
          output:  { length: result.payload[:summary].length, citations: result.payload[:citations]&.size || 0 },
        }
      end
    end

    # Wraps a surface call and records its status. Any exception is
    # captured as a failure rather than crashing the whole lane — the
    # other surfaces still run and report.
    def record_surface(surface)
      started = Time.current
      begin
        body = yield
        @results << {
          surface:     surface,
          status:      "success",
          duration_ms: ((Time.current - started) * 1000).round(1),
          **body,
        }
      rescue ContractFailure => e
        @results << { surface: surface, status: "contract_failure", error: e.message, duration_ms: ((Time.current - started) * 1000).round(1) }
      rescue => e
        @results << { surface: surface, status: "exception", error: "#{e.class}: #{e.message}", duration_ms: ((Time.current - started) * 1000).round(1) }
      end
    end

    def contract_check(result, field)
      raise ContractFailure, "service returned failure: #{Array(result.errors).join(', ')}" unless result.success
      raise ContractFailure, "missing or empty :#{field} in payload" unless yield(result.payload)
    end

    def write_json(usage_payload)
      path = File.join(@results_dir, "#{@timestamp}.json")
      File.write(path, JSON.pretty_generate(
        timestamp: @timestamp,
        sha:       ENV["GITHUB_SHA"],
        results:   @results,
        usage:     usage_payload,
      ))
      puts "[ai:live_evals] wrote #{path}"
    end

    def write_summary(usage_payload)
      summary_path = ENV["GITHUB_STEP_SUMMARY"]
      return unless summary_path

      services    = usage_payload["services"] || []
      total_cost  = usage_payload["total_cost_usd"] || 0.0
      total_calls = services.sum { |s| s["total_calls"].to_i }
      total_tok   = services.sum { |s| s["total_tokens"].to_i }

      lines = []
      lines << "## AI Live Eval — #{@timestamp}"
      lines << ""
      lines << "Total calls: **#{total_calls}** · Total tokens: **#{total_tok}** · Estimated cost: **$#{format('%.4f', total_cost)}**"
      lines << ""
      lines << "### Per-surface results"
      lines << ""
      lines << "| Surface | Status | Duration (ms) | Notes |"
      lines << "|---------|--------|---------------|-------|"
      @results.each do |r|
        notes = r[:status] == "success" ? format_output(r[:output]) : r[:error].to_s
        lines << "| #{r[:surface]} | #{r[:status]} | #{r[:duration_ms]} | #{notes.to_s.gsub('|', '\\|').truncate(120)} |"
      end
      lines << ""
      lines << "### Per-surface token + cost"
      lines << ""
      lines << "| Service | Calls | Input tokens | Output tokens | Cost (USD) | Models |"
      lines << "|---------|-------|--------------|---------------|------------|--------|"
      services.each do |s|
        lines << "| #{s['service']} | #{s['total_calls']} | #{s['total_input_tokens']} | #{s['total_output_tokens']} | $#{format('%.4f', s['total_cost_usd'].to_f)} | #{Array(s['models']).map { |m, c| "#{m}×#{c}" }.join(', ')} |"
      end

      File.open(summary_path, "a") { |f| f.puts lines.join("\n") }
    end

    def format_output(output)
      case output
      when Hash, Array then output.to_json.truncate(120)
      else output.to_s.truncate(120)
      end
    end
  end
end
