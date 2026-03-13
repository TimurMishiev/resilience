# Lightweight result value object returned by all service objects.
# No external dependencies.
#
# Usage:
#   ServiceResult.success(task: task)
#   ServiceResult.failure(errors: ["Transition not allowed"])
ServiceResult = Data.define(:success, :payload, :errors) do
  def self.success(payload = {})
    new(success: true, payload: payload, errors: [])
  end

  def self.failure(errors:, payload: {})
    new(success: false, payload: payload, errors: Array(errors))
  end

  def failure?
    !success
  end
end
