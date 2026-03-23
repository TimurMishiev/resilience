class AddPostureToAreasOfOperation < ActiveRecord::Migration[8.0]
  def change
    add_column :areas_of_operation, :posture, :string, null: false, default: "observe"
    add_column :areas_of_operation, :posture_changed_at, :datetime
    add_index :areas_of_operation, :posture
  end
end
