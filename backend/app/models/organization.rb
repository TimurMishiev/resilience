class Organization < ApplicationRecord
  has_many :users,         dependent: :restrict_with_exception
  has_many :sites,         dependent: :restrict_with_exception
  has_many :areas_of_operation, class_name: "AreaOfOperation", dependent: :restrict_with_exception

  validates :name, presence: true
  validates :slug, presence: true, uniqueness: true,
                   format: { with: /\A[a-z0-9\-]+\z/, message: "must be lowercase alphanumeric with hyphens" }
end
