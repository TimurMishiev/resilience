class SaluteReport < ApplicationRecord
  SHORT_FIELD_MAX_LENGTH = 200
  TEXT_MAX_LENGTH = 4_000

  belongs_to :area_of_operation
  belongs_to :site, optional: true
  belongs_to :created_by, class_name: "User"

  validates :size, length: { maximum: SHORT_FIELD_MAX_LENGTH }, allow_blank: true
  validates :activity, presence: true, length: { maximum: TEXT_MAX_LENGTH }
  validates :location, presence: true, length: { maximum: TEXT_MAX_LENGTH }
  validates :unit, length: { maximum: SHORT_FIELD_MAX_LENGTH }, allow_blank: true
  validates :equipment, length: { maximum: TEXT_MAX_LENGTH }, allow_blank: true
  validates :remarks, length: { maximum: TEXT_MAX_LENGTH }, allow_blank: true
  validates :observed_at, presence: true
  validate :site_belongs_to_area_of_operation

  scope :recent_first, -> { order(observed_at: :desc, created_at: :desc) }

  private

  def site_belongs_to_area_of_operation
    return if site.nil?
    return if site.area_of_operation_id == area_of_operation_id

    errors.add(:site_id, "must belong to the selected area of operation")
  end
end
