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

  def success? = success
  def failure?  = !success

  # Convenience: allow result.foo to read payload[:foo]
  def method_missing(name, *args, &block)
    key = name.to_sym
    payload.key?(key) ? payload[key] : super
  end

  def respond_to_missing?(name, include_private = false)
    payload.key?(name.to_sym) || super
  end
end
