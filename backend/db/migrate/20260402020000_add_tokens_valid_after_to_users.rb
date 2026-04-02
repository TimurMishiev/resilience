class AddTokensValidAfterToUsers < ActiveRecord::Migration[8.0]
  def change
    add_column :users, :tokens_valid_after, :datetime, precision: 6
  end
end
