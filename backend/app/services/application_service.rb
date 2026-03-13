# Base class for all service objects.
# Subclasses override #call and return a ServiceResult.
class ApplicationService
  def self.call(...)
    new(...).call
  end
end
