class CommanderIntent < ApplicationRecord
  TITLE_MAX_LENGTH = 120
  TEXT_MAX_LENGTH = 4_000

  belongs_to :area_of_operation
  belongs_to :created_by, class_name: "User"
  belongs_to :updated_by, class_name: "User"

  validates :title, presence: true, length: { maximum: TITLE_MAX_LENGTH }
  validates :objective, presence: true, length: { maximum: TEXT_MAX_LENGTH }
  validates :end_state, presence: true, length: { maximum: TEXT_MAX_LENGTH }
  validates :constraints, length: { maximum: TEXT_MAX_LENGTH }, allow_blank: true
  validates :area_of_operation_id, uniqueness: true
end
