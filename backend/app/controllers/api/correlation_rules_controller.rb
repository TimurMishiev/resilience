module Api
  class CorrelationRulesController < BaseController
    before_action :require_commander!, only: %i[create update destroy dry_run]

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
        render json: { errors: rule.errors.full_messages }, status: :unprocessable_entity
      end
    end

    # PATCH /api/correlation_rules/:id
    def update
      rule = CorrelationRule.find(params[:id])

      if rule.update(rule_params)
        render json: serialize_rule(rule)
      else
        render json: { errors: rule.errors.full_messages }, status: :unprocessable_entity
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
      hits = []

      signals.find_each do |signal|
        sites = dry_run_target_sites(rule)

        sites.each do |site|
          results = norm_conds["conditions"].map { |cond| dry_run_condition?(signal, site, cond) }
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

    def dry_run_target_sites(rule)
      site_id = rule.conditions["site_id"]
      return Site.where(id: site_id) if site_id.present?

      base = Site.active
      base = base.where(area_of_operation_id: rule.area_of_operation_id) if rule.area_of_operation_id.present?
      base
    end

    # Evaluates a single normalized condition against a signal + site pair.
    # Mirrors EvaluatorService logic but operates on historical signals without side effects.
    def dry_run_condition?(signal, site, cond)
      signal_type = cond["signal_type"]

      # Type filter — skip if this condition targets a different signal type
      return false if signal_type.present? && signal_type != signal.signal_type

      dry_run_proximity?(signal, site, cond) &&
        dry_run_magnitude?(signal, cond)     &&
        dry_run_count_threshold?(signal, site, cond)
    end

    def dry_run_proximity?(signal, site, cond)
      km = cond["proximity_km"].to_f
      return true if km.zero?

      Correlations::EvaluatorService.haversine_km(
        site.latitude.to_f, site.longitude.to_f,
        signal.lat.to_f,    signal.lng.to_f
      ) <= km
    end

    def dry_run_count_threshold?(signal, site, cond)
      threshold = cond["count_threshold"].to_i
      return true if threshold <= 1

      window_min   = cond["time_window_minutes"].to_i
      window_min   = 60 if window_min.zero?
      proximity_km = cond["proximity_km"].to_f

      recent = ExternalSignal.where(
        signal_type: signal.signal_type,
        occurred_at: window_min.minutes.ago(signal.occurred_at)..signal.occurred_at
      )

      count = recent.count do |s|
        Correlations::EvaluatorService.haversine_km(
          site.latitude.to_f, site.longitude.to_f,
          s.lat.to_f,         s.lng.to_f
        ) <= proximity_km
      end

      count >= threshold
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
