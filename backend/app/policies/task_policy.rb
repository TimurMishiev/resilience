class TaskPolicy < ApplicationPolicy
  # All authenticated users (operators and commanders) may read and work tasks.
  # Tasks are the primary operational unit — operators are expected to create,
  # update, and transition them as part of their workflow.
  def index?              = true
  def show?               = true
  def create?             = true
  def update?             = true
  def transition?         = true
  def allowed_transitions? = true
end
