module Api
  class CorrelationRulesController < BaseController
    before_action :require_commander!, only: %i[create update destroy]

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

    private

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
