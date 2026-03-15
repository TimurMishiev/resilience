ENV["BUNDLE_GEMFILE"] ||= File.expand_path("../Gemfile", __dir__)

require "bundler/setup" # Set up gems listed in the Gemfile.
require "bootsnap/setup" # Speed up boot time by caching expensive operations.

# Load .env with overwrite so a blank shell export (e.g. ANTHROPIC_API_KEY="")
# never silences a value that is defined in .env.
require "dotenv"
Dotenv.overwrite(File.expand_path("../.env", __dir__))
