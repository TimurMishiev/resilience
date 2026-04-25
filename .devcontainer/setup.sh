#!/usr/bin/env bash
# Devcontainer post-create setup. Runs once when the container is built.
# Idempotent — safe to re-run after an image rebuild.
set -euo pipefail

echo "[devcontainer] Installing backend dependencies..."
cd /workspaces/resilience/backend
bundle install --jobs 4

echo "[devcontainer] Installing frontend dependencies..."
cd /workspaces/resilience/frontend
yarn install --frozen-lockfile

echo "[devcontainer] Setting up databases (PostgreSQL 17)..."
cd /workspaces/resilience/backend
RAILS_ENV=development bundle exec rails db:create db:schema:load 2>/dev/null || true
RAILS_ENV=test bundle exec rails db:create db:schema:load 2>/dev/null || true

echo "[devcontainer] Seeding demo data..."
RAILS_ENV=development bundle exec rails db:seed || echo "[devcontainer] Seed skipped (already seeded or seed file missing)"

echo "[devcontainer] Setup complete."
echo ""
echo "Start the backend:   cd backend  && bundle exec rails s"
echo "Start the frontend:  cd frontend && yarn dev"
echo "Run backend tests:   cd backend  && bundle exec rspec"
echo "Run frontend tests:  cd frontend && yarn test"
