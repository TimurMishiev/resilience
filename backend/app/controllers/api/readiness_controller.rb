module Api
  class ReadinessController < BaseController
    def index
      sites = Site.all.includes(:tasks).order(:name)
      computed_at = Time.current

      result = sites.map do |site|
        if as_of
          task_ids = site.tasks.pluck(:id)
          projection = Replay::ProjectionService.call(
            entity_type: "Task",
            entity_ids: task_ids,
            as_of: as_of
          )
          snapshots = projection.payload[:snapshots]
          task_proxies = snapshots.map { |s| TaskProxy.new(s["workflow_status"]) }
          calc = Readiness::CalculationService.call(site: site, tasks: task_proxies)
        else
          calc = Readiness::CalculationService.call(site: site, tasks: site.tasks)
        end

        {
          site_id:     site.id,
          site_name:   site.name,
          score:       calc.payload[:score],
          counts:      calc.payload[:counts],
          computed_at: computed_at.iso8601,
          as_of:       as_of&.iso8601
        }
      end

      render json: result
    end

    # Lightweight duck-type proxy so CalculationService can work with replay snapshots.
    TaskProxy = Struct.new(:workflow_status)
  end
end
