module Readiness
  # Computes the readiness score for a site based on its current task state.
  #
  # Formula (V1, task-driven only):
  #   resolved_ratio    = resolved_tasks / total_tasks
  #   non_blocked_ratio = non_blocked_tasks / total_tasks
  #   score             = (resolved_ratio * 0.6) + (non_blocked_ratio * 0.4)
  #
  # Returns nil when total_tasks == 0 (no data, not zero readiness).
  # Returns a float between 0.0 and 1.0 otherwise.
  #
  # This is a pure calculation — no side effects, no database writes.
  class CalculationService < ApplicationService
    RESOLVED_WEIGHT     = 0.6
    NON_BLOCKED_WEIGHT  = 0.4

    def initialize(site:, tasks: nil)
      @site = site
      # Accept an explicit task collection for testability and replay contexts.
      # Falls back to live association if not provided.
      @tasks = tasks
    end

    def call
      task_list = @tasks || @site.tasks
      total = task_list.count

      return ServiceResult.success(score: nil, counts: empty_counts(total)) if total.zero?

      if task_list.is_a?(ActiveRecord::Relation)
        resolved    = task_list.where(workflow_status: "resolved").count
        blocked     = task_list.where(workflow_status: "blocked").count
        non_blocked = total - blocked
      else
        resolved    = task_list.count { |t| t.workflow_status == "resolved" }
        non_blocked = task_list.count { |t| t.workflow_status != "blocked" }
      end

      resolved_ratio    = resolved.to_f / total
      non_blocked_ratio = non_blocked.to_f / total
      score = (resolved_ratio * RESOLVED_WEIGHT) + (non_blocked_ratio * NON_BLOCKED_WEIGHT)

      ServiceResult.success(
        score: score.round(4),
        counts: {
          total: total,
          resolved: resolved,
          non_blocked: non_blocked,
          blocked: total - non_blocked
        }
      )
    end

    private

    def empty_counts(total)
      { total: total, resolved: 0, non_blocked: 0, blocked: 0 }
    end
  end
end
