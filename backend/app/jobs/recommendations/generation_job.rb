module Recommendations
  class GenerationJob < ApplicationJob
    queue_as :background

    def perform
      result = Recommendations::GeneratorService.call
      if result.success?
        Rails.logger.info "[GenerationJob] created=#{result.created} invalid=#{result.invalid_count}"
      else
        Rails.logger.error "[GenerationJob] failed: #{result.errors.join(', ')}"
      end
    end
  end
end
