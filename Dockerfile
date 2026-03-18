# syntax=docker/dockerfile:1
# check=error=true

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

# Declare before the first FROM so it's available in all subsequent FROM lines.
ARG RUBY_VERSION=3.4.7

# ──── Stage 1: Build the React/Vite frontend ─────────────────────────────────
FROM node:22-slim AS frontend-build

WORKDIR /app

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
    BUNDLE_WITHOUT="development" \
    LD_PRELOAD="/usr/local/lib/libjemalloc.so"

# ──── Stage 3: Install gems ───────────────────────────────────────────────────
FROM base AS build

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential git libpq-dev libyaml-dev pkg-config && \
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

ENTRYPOINT ["/rails/bin/docker-entrypoint"]

EXPOSE 80
CMD ["./bin/thrust", "./bin/rails", "server"]
