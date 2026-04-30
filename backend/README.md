# Resilience — Backend

Rails 8.1 API for the Resilience operational intelligence platform.

This directory holds the backend. For project overview, architecture, stack, deploy details, and full setup instructions see:

- [`../README.md`](../README.md) — project overview, architecture diagram, tech stack, CI pipeline, key engineering decisions
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — local dev setup, test commands, code conventions
- [`../CLAUDE.md`](../CLAUDE.md) — repo entrypoint for AI agents, including the local test-DB setup

## Quick reference

- Run tests: `TEST_DATABASE_PORT=5434 bundle exec rspec`
- Rebuild test DB: see the "Local test setup" section in [`../CLAUDE.md`](../CLAUDE.md)
- Run server: `RAILS_MAX_THREADS=48 bundle exec rails server`
- Policies: `app/policies/` (32 Pundit policies)
- Services: `app/services/` (75 service objects)
- Jobs + recurring schedules: `app/jobs/` + `config/recurring.yml` (16 job classes, 20 production schedules)
