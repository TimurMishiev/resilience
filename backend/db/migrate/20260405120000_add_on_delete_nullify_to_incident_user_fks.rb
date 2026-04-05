# Aligns DB-level FK behavior with Rails-level `dependent: :nullify` on
# Incident#assigned_to and Incident#prosecuted_by. Without ON DELETE SET NULL,
# the DB defaults to RESTRICT — blocking user deletion even though Rails
# intends to nullify the FK. Defence-in-depth: users are never hard-deleted
# (Organization enforces :restrict_with_exception), but the DB constraint
# should match the declared Rails semantics.
class AddOnDeleteNullifyToIncidentUserFks < ActiveRecord::Migration[8.0]
  def up
    # Drop the old RESTRICT constraints and re-add with ON DELETE SET NULL.
    remove_foreign_key :incidents, column: :assigned_to_id
    remove_foreign_key :incidents, column: :prosecuted_by_id

    add_foreign_key :incidents, :users, column: :assigned_to_id,    on_delete: :nullify
    add_foreign_key :incidents, :users, column: :prosecuted_by_id,  on_delete: :nullify
  end

  def down
    remove_foreign_key :incidents, column: :assigned_to_id
    remove_foreign_key :incidents, column: :prosecuted_by_id

    add_foreign_key :incidents, :users, column: :assigned_to_id
    add_foreign_key :incidents, :users, column: :prosecuted_by_id
  end
end
