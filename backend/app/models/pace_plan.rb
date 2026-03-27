class PacePlan < ApplicationRecord
  TEXT_MAX_LENGTH = 4_000

  belongs_to :area_of_operation
  belongs_to :created_by, class_name: "User"
  belongs_to :updated_by, class_name: "User"

  validates :primary_plan, presence: true, length: { maximum: TEXT_MAX_LENGTH }
  validates :alternate_plan, presence: true, length: { maximum: TEXT_MAX_LENGTH }
  validates :contingency_plan, presence: true, length: { maximum: TEXT_MAX_LENGTH }
  validates :emergency_plan, presence: true, length: { maximum: TEXT_MAX_LENGTH }
  validates :notes, length: { maximum: TEXT_MAX_LENGTH }, allow_blank: true
  validates :area_of_operation_id, uniqueness: true
end
