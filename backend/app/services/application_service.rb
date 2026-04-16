# Base class for all service objects.
# Subclasses override #call and return a ServiceResult.
class ApplicationService
  def self.call(...)
    new(...).call
  end

  def self.commander_role?(role)
    %w[commander admin].include?(role.to_s)
  end

  private

  def commander_role?(role)
    self.class.commander_role?(role)
  end
end
