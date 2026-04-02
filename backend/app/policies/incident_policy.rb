class IncidentPolicy < ApplicationPolicy
  # All authenticated users may read incidents and perform routine operational
  # actions (transition, note, assign). Prosecution and high-impact steps
  # are commander-only.
  def index?               = true
  def show?                = true
  def update?              = operator_or_above?
  def transition?          = operator_or_above?
  def allowed_transitions? = true
  def chain?               = true
  def list_notes?          = true
  def add_note?            = operator_or_above?
  def list_prosecution_steps? = true

  # Operators may self-assign — the controller enforces the exact assignment
  # rules (self-assign/own-release) independently of this policy.
  def assign? = operator_or_above?

  # Kill-chain prosecution is commander-only: high-impact irreversible action.
  def initiate_prosecution? = commander?
  def add_prosecution_step? = commander?
end
