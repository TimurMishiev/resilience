class Organization < ApplicationRecord
  has_many :users,         dependent: :nullify
  has_many :sites,         dependent: :nullify
  has_many :areas_of_operation, dependent: :nullify

  validates :name, presence: true
  validates :slug, presence: true, uniqueness: true,
                   format: { with: /\A[a-z0-9\-]+\z/, message: "must be lowercase alphanumeric with hyphens" }
end
