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

      signals = ExternalSignal.where(occurred_at: since_time..Time.current).order(occurred_at: :desc)
      signals = signals.where(signal_type: rule.conditions["signal_type"]) if rule.conditions["signal_type"].present?

      hits = []

      signals.find_each do |signal|
        sites = dry_run_target_sites(rule)

        sites.each do |site|
          next unless dry_run_proximity?(signal, site, rule)
          next unless dry_run_count_threshold?(signal, site, rule)
          next unless dry_run_magnitude?(signal, rule)

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

    def dry_run_proximity?(signal, site, rule)
      km = rule.conditions["proximity_km"].to_f
      return true if km.zero?

      Correlations::EvaluatorService.haversine_km(
        site.latitude.to_f, site.longitude.to_f,
        signal.lat.to_f, signal.lng.to_f
      ) <= km
    end

    def dry_run_count_threshold?(signal, site, rule)
      threshold = rule.conditions["count_threshold"].to_i
      return true if threshold <= 1

      window_min   = rule.conditions["time_window_minutes"].to_i
      window_min   = 60 if window_min.zero?
      proximity_km = rule.conditions["proximity_km"].to_f

      recent = ExternalSignal.where(
        signal_type: signal.signal_type,
        occurred_at: window_min.minutes.ago(signal.occurred_at)..signal.occurred_at
      )

      count = recent.count do |s|
        Correlations::EvaluatorService.haversine_km(
          site.latitude.to_f, site.longitude.to_f,
          s.lat.to_f, s.lng.to_f
        ) <= proximity_km
      end

      count >= threshold
    end

    def dry_run_magnitude?(signal, rule)
      min = rule.conditions["magnitude_min"]
      return true if min.blank?
      signal.magnitude.to_f >= min.to_f
    end

    def rule_params
      params.require(:correlation_rule).permit(
        :name, :description, :is_active, :cooldown_minutes, :area_of_operation_id,
        conditions: {},
        actions:    {}
      )
    end

    def serialize_rule(rule)
      rule.as_json(only: %i[
        id name description is_active cooldown_minutes
        area_of_operation_id last_fired_at created_at updated_at
      ]).merge(
        conditions:  rule.conditions,
        actions:     rule.actions,
        created_by:  rule.created_by_id
      )
    end
  end
end
