class AuditEventAccess
  attr_reader :entity_id

  def initialize(entity_id:)
    @entity_id = entity_id
  end
end
