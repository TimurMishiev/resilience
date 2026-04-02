class AuditEventAccess
  attr_reader :entity_type, :entity_id

  def initialize(entity_type:, entity_id:)
    @entity_type = entity_type
    @entity_id = entity_id
  end
end
