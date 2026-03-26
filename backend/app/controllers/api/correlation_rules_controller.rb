module Api
  class CorrelationRulesController < BaseController
    before_action :require_commander!, only: %i[create update destroy dry_run]

    # GET /api/correlation_rules/effectiveness
    # Returns per-rule analytics for all rules (batch — avoids N+1).
    # Accessible to all authenticated users so operators can see rule health.
    def effectiveness
      result = Rules::EffectivenessService.call
      render json: result.payload[:stats].index_by { |s| s[:rule_id] }
    end

    # GET /api/correlation_rules
    def index
      rules = CorrelationRule.order(created_at: :desc)
      rules = rules.active if params[:active_only] == "true"
      records, meta = paginate(rules)
      render json: { data: records.map { |r| serialize_rule(r) }, meta: meta }
    end

    # GET /api/correlation_rules/:id
    def show
      rule = CorrelationRule.find(params[:id])
      render json: serialize_rule(rule)
    end

    # POST /api/correlation_rules
    def create
      rule = CorrelationRule.new(rule_params)
      rule.created_by = current_user

      if rule.save
        render json: serialize_rule(rule), status: :created
      else
        render json: { errors: rule.errors.full_messages }, status: :unprocessable_content
      end
    end

    # PATCH /api/correlation_rules/:id
    def update
      rule = CorrelationRule.find(params[:id])

      if rule.update(rule_params)
        render json: serialize_rule(rule)
      else
        render json: { errors: rule.errors.full_messages }, status: :unprocessable_content
      end
    end

    # DELETE /api/correlation_rules/:id
    def destroy
      rule = CorrelationRule.find(params[:id])
      rule.destroy!
      head :no_content
    end

    # POST /api/correlation_rules/:id/dry_run
    # Evaluates this rule against the last N hours of signals WITHOUT firing any actions.
    # Returns a list of signals that would have triggered the rule and which sites.
    def dry_run
      rule       = CorrelationRule.find(params[:id])
      hours      = (params[:hours] || 24).to_i.clamp(1, 168) # max 1 week
      since_time = hours.hours.ago

      # For flat rules, filter by signal type for efficiency.
      # Compound rules span multiple signal types — fetch all and let condition checks filter.
      signals = ExternalSignal.where(occurred_at: since_time..Time.current).order(occurred_at: :desc)
      unless rule.compound?
        flat_type = rule.conditions["signal_type"]
        signals = signals.where(signal_type: flat_type) if flat_type.present?
      end

      norm_conds = rule.normalized_conditions

      # Hoist the site query outside the per-signal loop — it never changes.
      sites = dry_run_target_sites(rule)

      # Preload historical signal windows once per signal_type so dry-run can
      # mirror evaluator corroboration/count checks without per-signal queries.
      signal_pool = build_signal_pool(norm_conds["conditions"], since_time, signals)

      hits = []

      signals.find_each do |signal|
        sites.each do |site|
          results = norm_conds["conditions"].map { |cond| dry_run_condition?(signal, site, cond, signal_pool) }
          match   = norm_conds["operator"] == "OR" ? results.any? : results.all?
          next unless match

          distance_km = Correlations::EvaluatorService.haversine_km(
            site.latitude.to_f, site.longitude.to_f,
            signal.lat.to_f, signal.lng.to_f
          )

          hits << {
            signal_id:    signal.id,
            signal_type:  signal.signal_type,
            source:       signal.source,
            lat:          signal.lat,
            lng:          signal.lng,
            magnitude:    signal.magnitude,
            occurred_at:  signal.occurred_at,
            site_id:      site.id,
            site_name:    site.name,
            distance_km:  distance_km.round(2),
            would_fire:   rule.actions.keys
          }
        end
      end

      render json: {
        rule_id:       rule.id,
        rule_name:     rule.name,
        window_hours:  hours,
        total_matches: hits.size,
        matches:       hits.first(50)  # cap response at 50 for safety
      }
    end

    private

    # Builds a hash of signal_type → array of lightweight signal structs for all
    # typed conditions. Called once per dry_run request so corroboration/count
    # checks never hit the DB inside the nested signal/site loop.
    def build_signal_pool(conditions, since_time, candidate_signals)
      max_window_by_type = {}

      conditions.each do |cond|
        next unless cond["signal_type"].present?

        max_window_by_type[cond["signal_type"]] = [
          max_window_by_type[cond["signal_type"]] || 0,
          normalized_time_window_minutes(cond),
        ].max
      end

      untyped_threshold_window = conditions
        .select { |cond| cond["signal_type"].blank? && cond["count_threshold"].to_i > 1 }
        .map { |cond| normalized_time_window_minutes(cond) }
        .max

      if untyped_threshold_window.present?
        candidate_signals.reorder(nil).distinct.pluck(:signal_type).compact.each do |signal_type|
          max_window_by_type[signal_type] = [
            max_window_by_type[signal_type] || 0,
            untyped_threshold_window,
          ].max
        end
      end

      max_window_by_type.each_with_object({}) do |(signal_type, max_window_min), pool|
        pool_start = max_window_min.minutes.ago(since_time)
        pool[signal_type] = ExternalSignal
          .where(signal_type: signal_type, occurred_at: pool_start..Time.current)
          .pluck(:signal_type, :occurred_at, :lat, :lng)
          .map { |st, oa, lt, lg| { signal_type: st, occurred_at: oa, lat: lt.to_f, lng: lg.to_f } }
      end
    end

    def dry_run_target_sites(rule)
      Correlations::EvaluatorService.target_sites_scope(rule)
    end

    # Evaluates a single normalized condition against a signal + site pair.
    # Mirrors EvaluatorService logic but operates on historical signals without side effects.
    def dry_run_condition?(signal, site, cond, signal_pool = {})
      signal_type = cond["signal_type"]

      if signal_type.present? && signal_type != signal.signal_type
        return dry_run_corroboration?(signal, site, cond, signal_pool)
      end

      dry_run_proximity?(signal, site, cond) &&
        dry_run_magnitude?(signal, cond)     &&
        dry_run_count_threshold?(signal, site, cond, signal_pool)
    end

    def dry_run_corroboration?(signal, site, cond, signal_pool = {})
      threshold = [ cond["count_threshold"].to_i, 1 ].max
      dry_run_matching_signal_count(signal, site, cond, signal_pool[cond["signal_type"]] || []) >= threshold
    end

    def dry_run_proximity?(signal, site, cond)
      km = cond["proximity_km"].to_f
      return true if km.zero?

      Correlations::EvaluatorService.haversine_km(
        site.latitude.to_f, site.longitude.to_f,
        signal.lat.to_f,    signal.lng.to_f
      ) <= km
    end

    def dry_run_count_threshold?(signal, site, cond, signal_pool = {})
      threshold = cond["count_threshold"].to_i
      return true if threshold <= 1

      dry_run_matching_signal_count(signal, site, cond, signal_pool[signal.signal_type] || []) >= threshold
    end

    def dry_run_matching_signal_count(signal, site, cond, pool)
      window_min   = normalized_time_window_minutes(cond)
      proximity_km = cond["proximity_km"].to_f
      window_start = window_min.minutes.ago(signal.occurred_at)

      count = pool.count do |s|
        s[:occurred_at] >= window_start &&
          s[:occurred_at] <= signal.occurred_at &&
          (proximity_km.zero? || Correlations::EvaluatorService.haversine_km(
            site.latitude.to_f, site.longitude.to_f,
            s[:lat],            s[:lng]
          ) <= proximity_km)
      end

      count
    end

    def normalized_time_window_minutes(cond)
      window_min = cond["time_window_minutes"].to_i
      window_min.zero? ? 60 : window_min
    end

    def dry_run_magnitude?(signal, cond)
      min = cond["magnitude_min"]
      return true if min.blank?
      signal.magnitude.to_f >= min.to_f
    end

    def rule_params
      params.require(:correlation_rule).permit(
        :name, :description, :is_active, :cooldown_minutes, :area_of_operation_id,
        conditions:  {},
        actions:     {},
        mitre_tags:  []
      )
    end

    def serialize_rule(rule)
      rule.as_json(only: %i[
        id name description is_active cooldown_minutes
        area_of_operation_id last_fired_at created_at updated_at
      ]).merge(
        conditions:  rule.conditions,
        actions:     rule.actions,
        created_by:  rule.created_by_id,
        mitre_tags:  rule.mitre_tags || []
      )
    end
  end
end
