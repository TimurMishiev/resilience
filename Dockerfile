# syntax=docker/dockerfile:1
# check=error=true;skip=SecretsUsedInArgOrEnv

# Multi-stage build: React frontend → Rails backend → combined production image.
# The built frontend is copied into Rails' public/ directory so a single app
# serves both the SPA and the API from the same origin.
#
# Build from the repo root:
#   docker build -t resilience .
#
# Required secrets at runtime (set via `flyctl secrets set`):
#   RAILS_MASTER_KEY    — from backend/config/master.key
#   DATABASE_URL        — Fly Postgres connection string
#   SECRET_KEY_BASE     — output of `rails secret`
#   ANTHROPIC_API_KEY   — Claude API key
# Optional observability:
#   SENTRY_DSN          — Rails runtime error reporting DSN
#
# Optional frontend build args:
#   VITE_SENTRY_DSN     — public browser DSN baked into the SPA bundle
#   SENTRY_RELEASE      — release string shared by frontend and backend
#   SENTRY_AUTH_TOKEN   — enables source map upload during the frontend build
#   SENTRY_ORG          — Sentry org slug for source map upload
#   SENTRY_PROJECT      — Sentry project slug for source map upload

# Declare before the first FROM so it's available in all subsequent FROM lines.
ARG RUBY_VERSION=3.4.7
ARG VITE_SENTRY_DSN=""
ARG VITE_SENTRY_ENVIRONMENT="production"
ARG SENTRY_RELEASE=""
ARG SENTRY_AUTH_TOKEN=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""

# ──── Stage 1: Build the React/Vite frontend ─────────────────────────────────
FROM node:22-slim AS frontend-build

WORKDIR /app

ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_ENVIRONMENT
ARG SENTRY_RELEASE
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT

ENV VITE_SENTRY_DSN="${VITE_SENTRY_DSN}" \
    VITE_SENTRY_ENVIRONMENT="${VITE_SENTRY_ENVIRONMENT}" \
    VITE_SENTRY_RELEASE="${SENTRY_RELEASE}" \
    SENTRY_AUTH_TOKEN="${SENTRY_AUTH_TOKEN}" \
    SENTRY_ORG="${SENTRY_ORG}" \
    SENTRY_PROJECT="${SENTRY_PROJECT}"

# Install dependencies first (better layer caching)
COPY frontend/package.json frontend/yarn.lock ./
RUN yarn install --frozen-lockfile --non-interactive

COPY frontend/ .
RUN yarn build

# ──── Stage 2: Ruby base (shared between build and final) ────────────────────
FROM docker.io/library/ruby:$RUBY_VERSION-slim AS base

WORKDIR /rails

# Install runtime system packages
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y curl libjemalloc2 postgresql-client && \
    ln -s /usr/lib/$(uname -m)-linux-gnu/libjemalloc.so.2 /usr/local/lib/libjemalloc.so && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

ENV RAILS_ENV="production" \
    BUNDLE_DEPLOYMENT="1" \
    BUNDLE_PATH="/usr/local/bundle" \
    BUNDLE_WITHOUT="development test" \
    LD_PRELOAD="/usr/local/lib/libjemalloc.so" \
    THRUSTER_HTTP_IDLE_TIMEOUT="3600" \
    THRUSTER_HTTP_WRITE_TIMEOUT="3600"

# ──── Stage 3: Install gems ───────────────────────────────────────────────────
FROM base AS build

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential cmake git libpq-dev libyaml-dev pkg-config && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

# Copy Gemfile first for better layer caching
COPY backend/Gemfile backend/Gemfile.lock ./

RUN bundle install && \
    rm -rf ~/.bundle/ "${BUNDLE_PATH}"/ruby/*/cache "${BUNDLE_PATH}"/ruby/*/bundler/gems/*/.git && \
    bundle exec bootsnap precompile -j 1 --gemfile

# Copy the full backend source
COPY backend/ .

RUN bundle exec bootsnap precompile -j 1 app/ lib/

# ──── Stage 4: Production image ───────────────────────────────────────────────
FROM base

# Non-root user for security
RUN groupadd --system --gid 1000 rails && \
    useradd rails --uid 1000 --gid 1000 --create-home --shell /bin/bash
USER 1000:1000

# Copy built gems and Rails app
COPY --chown=rails:rails --from=build "${BUNDLE_PATH}" "${BUNDLE_PATH}"
COPY --chown=rails:rails --from=build /rails /rails

# Overlay the pre-built React frontend into Rails' public/ directory.
# Rails' static file server (ActionDispatch::Static) will serve these files,
# and the catch-all route returns index.html for SPA deep links.
COPY --chown=rails:rails --from=frontend-build /app/dist /rails/public

# Defense against build-cache poisoning of the previous COPY.
#
# Background (May 2026 incident): four sequential Fly deploys (v50-v53)
# reached production with /rails/public containing ONLY the backend's
# robots.txt, despite the frontend-build stage succeeding upstream and
# yarn build producing all expected dist/ artifacts. The remote
# builder served the COPY layer from a stale cache that pre-dated the
# repo's frontend assets. Rails happily started and served the API,
# Fly's healthcheck on /up returned 200 (Rails default healthcheck
# doesn't depend on the SPA), every deploy reported success — but
# every SPA route 404'd in production. The issue was caught by the
# Playwright production smoke spec failing on `page.goto('/login')`.
#
# This RUN step transforms the silent failure into a loud build
# failure. If the frontend bundle didn't land, the build aborts before
# producing an image; Fly's deploy halts before any machine restart;
# the human sees the FATAL message and rebuilds with --no-cache.
#
# Why test the OTHER COPY layers aren't worth verifying: lines 108
# (bundle) and 109 (rails source) both produce loud boot failures
# under the same cache-poison scenario — Rails can't start without
# its gems or its source. Only line 114 (frontend overlay) is silent
# because Rails doesn't depend on it to boot.
#
# Why -s and not -f: `test -f` accepts a zero-byte file. A truncated
# index.html would render a blank page in the browser. -s requires
# non-zero size, which is the actual invariant we care about.
RUN test -s /rails/public/index.html || \
    (echo "FATAL: /rails/public/index.html is missing or empty after the frontend overlay COPY. Likely a BuildKit cache poison — the layer was served from a stale cache that did not include the dist/ output. Rebuild with --no-cache: flyctl deploy --no-cache" && \
     ls -la /rails/public/ && \
     exit 1)

ENTRYPOINT ["/rails/bin/docker-entrypoint"]

EXPOSE 80
CMD ["./bin/thrust", "./bin/rails", "server"]
