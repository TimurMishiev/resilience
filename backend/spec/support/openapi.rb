# OpenAPI contract enforcement for request specs.
#
# Tranche E2 of the 87→90 plan. Wires committee-rails into RSpec so
# request specs tagged with `:openapi` validate their HTTP responses
# against contracts/openapi.yaml. The contract document was already
# present in the repo (763 lines covering the operator-facing endpoints)
# but was decorative — no test verified that controller responses
# matched it. Spec drift was a silent failure mode.
#
# Opt-in via metadata so the rollout can grow incrementally:
#
#   RSpec.describe "Api::Sites", type: :request, openapi: true do
#     it "returns 200 with all sites" do
#       get "/api/sites", headers: auth_headers(current_user)
#       assert_response_schema_confirm(200)
#     end
#   end
#
# Without `openapi: true`, specs run unchanged. Specs that opt in MUST
# call `assert_response_schema_confirm(<expected_status>)` after each
# request — the gate validates the LAST response against the path +
# status code in the OpenAPI document, raising a clear assertion error
# if the JSON shape, missing fields, or types don't match.
#
# Why opt-in rather than blanket validation? The OpenAPI document only
# covers a representative subset of endpoints (sites, tasks, assets,
# readiness, audit_events, ai/{filter,summary}). Forcing every request
# spec to validate would drown the suite in "no schema for path X"
# errors on endpoints that aren't documented yet — which is its own
# follow-up: extend the contract first, then enable.
require "committee/rails/test/methods"

OPENAPI_SCHEMA_PATH = Rails.root.join("..", "contracts", "openapi.yaml").freeze

# Helper module exposing the `committee_options` method that
# Committee::Rails::Test::Methods looks up at validate time. The options
# point at our committed contract document and tell committee how to
# resolve Rails' /api-prefixed routes against the spec's unprefixed
# paths (the spec lists /sites, /tasks; routes are /api/sites,
# /api/tasks). Strict mode is non-negotiable — without it, undocumented
# responses silently pass and the gate is decorative.
module OpenapiHelper
  def committee_options
    @committee_options ||= {
      schema_path: OPENAPI_SCHEMA_PATH.to_s,
      strict:      true,
      prefix:      "/api",
      # NOTE: openapi_parser emits a deprecation warning about
      # `strict_reference_validation` defaulting to true in a future
      # release. The setting is on the parser itself, not on
      # committee_options — passing it via committee is a no-op. The
      # warning is loud but harmless; the gate works correctly without
      # the flag. Re-evaluate when the parser version is bumped.
    }
  end
end

RSpec.configure do |config|
  config.include Committee::Rails::Test::Methods, openapi: true
  config.include OpenapiHelper,                   openapi: true
end
