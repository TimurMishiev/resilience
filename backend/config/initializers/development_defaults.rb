# Local development env defaults.
#
# Production values come from fly.toml [env]; tests configure via
# spec/rails_helper.rb + ENV. This initializer sets sensible defaults for
# anyone running `bin/rails server` against a local database without
# exhaustive .env configuration. Each value uses ||= so any actual ENV /
# .env / .env.development.local override still wins.
#
# Why an initializer rather than a checked-in .env.development:
# `backend/.env.*` is gitignored (see /.gitignore) — only `.env.example`
# is allowed through. An initializer is the standard Rails-idiomatic way
# to ship environment-specific defaults that future contributors inherit
# automatically without copying example files.
return unless Rails.env.development?

# ── Database port ──────────────────────────────────────────────────────────
# This platform requires PostGIS for the geography columns on sites and
# external_signals. PostgreSQL@17 is the only local server with the PostGIS
# extension installed (per CLAUDE.md), and it listens on 5434. PG@16 (port
# 5432, the system default) does NOT have PostGIS and would fail every dev
# query that touches a geography column.
#
# Pre-fix history: database.yml's default block hard-coded port 5432, so
# `bundle exec rails server` would silently connect to PG@16 and produce
# `relation "users" does not exist` errors (the dev DB is on @17, not @16).
# Operators worked around it with inline `DATABASE_URL=...` every time.
# Now: database.yml reads DATABASE_PORT from the default block, and this
# initializer sets DATABASE_PORT=5434 so the canonical `bin/rails server`
# just works.
ENV["DATABASE_PORT"] ||= "5434"

# ── SSE stream caps ────────────────────────────────────────────────────────
# Production sets SSE_MAX_STREAMS_PER_USER=12 / _PER_IP=12 via fly.toml.
# The hard-coded fallback in Sse::StreamAdmission is 8 / 24, which is
# tight for normal local browsing: each tab opens ~3 streams (signals,
# audit_events, sites) and Playwright e2e runs accumulate leases against
# the 180s TTL. Two e2e runs back-to-back + a browser tab will exceed 8
# easily, producing HTTP 429 on /api/events and breaking every realtime
# panel.
#
# 24 / 48 gives generous headroom for ~8 concurrent tabs without masking
# real production capacity issues — the prod fly.toml override still
# governs prod machine sizing decisions.
ENV["SSE_MAX_STREAMS_PER_USER"] ||= "24"
ENV["SSE_MAX_STREAMS_PER_IP"]   ||= "48"
