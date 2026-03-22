module Api
  class AreasOfOperationController < BaseController
    before_action :require_commander!, only: %i[create update destroy]

    # GET /api/areas_of_operation
    def index
      areas = AreaOfOperation.order(:name)
      areas = areas.by_threat(params[:threat_level]) if params[:threat_level].present?
      records, meta = paginate(areas)
      render json: { data: records.map { |a| serialize_area(a) }, meta: meta }
    end

    # GET /api/areas_of_operation/:id
    def show
      area = AreaOfOperation.find(params[:id])
      render json: serialize_area(area)
    end

    # POST /api/areas_of_operation
    def create
      area = AreaOfOperation.new(area_params)
      area.created_by = current_user

      if area.save
        render json: serialize_area(area), status: :created
      else
        render json: { errors: area.errors.full_messages }, status: :unprocessable_entity
      end
    end

    # PATCH /api/areas_of_operation/:id
    def update
      area = AreaOfOperation.find(params[:id])

      if area.update(area_params)
        render json: serialize_area(area)
      else
        render json: { errors: area.errors.full_messages }, status: :unprocessable_entity
      end
    end

    # DELETE /api/areas_of_operation/:id
    def destroy
      area = AreaOfOperation.find(params[:id])
      area.destroy!
      head :no_content
    end

    private

    def area_params
      params.require(:area_of_operation).permit(
        :name, :description, :threat_level, :color,
        geometry: {}
      )
    end

    def serialize_area(area)
      area.as_json(only: %i[
        id name description threat_level color
        created_at updated_at
      ]).merge(
        geometry:   area.geometry,
        created_by: area.created_by_id
      )
    end
  end
end
