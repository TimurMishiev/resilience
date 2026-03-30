RSpec.configure do |config|
  config.before(:each, type: :request) do
    Rack::Attack.cache.store = ActiveSupport::Cache::MemoryStore.new
    Rack::Attack.reset!
  end
end
