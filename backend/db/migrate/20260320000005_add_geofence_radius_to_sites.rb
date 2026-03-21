class AddGeofenceRadiusToSites < ActiveRecord::Migration[8.0]
  def change
    add_column :sites, :geofence_radius_km, :float, default: 50.0, null: false
  end
end
