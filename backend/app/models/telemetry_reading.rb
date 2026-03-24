class TelemetryReading < ApplicationRecord
  # The partitioned telemetry parent intentionally does not enforce a database
  # primary key on `id` alone because PostgreSQL requires the partition key to
  # participate in global uniqueness. UUID collisions remain vanishingly
  # unlikely, and the application never foreign-keys telemetry rows by id.
  self.primary_key = :id

  belongs_to :asset

  validates :lat, presence: true, numericality: { greater_than_or_equal_to: -90, less_than_or_equal_to: 90 }
  validates :lng, presence: true, numericality: { greater_than_or_equal_to: -180, less_than_or_equal_to: 180 }
  validates :occurred_at, presence: true
end
