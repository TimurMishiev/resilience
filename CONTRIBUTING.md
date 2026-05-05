# Contributing to Resilience

## Development Setup

### Three ways to set up, ordered by least friction

**1. Devcontainer / GitHub Codespaces (zero local install).**
Open the repo in VS Code with the Dev Containers extension installed,
or in a Codespace. The container image pins Ruby 3.4.7, Node 22.13.0,
and PostgreSQL 17 — same versions CI uses. `.devcontainer/setup.sh`
runs `bundle install`, `yarn install`, and `db:schema:load`
automatically.

**2. asdf or mise (single-command tool sync).**
The repo carries a `.tool-versions` file. With asdf installed:
```bash
asdf install
```
This installs Ruby 3.4.7, Node 22.13.0, and PostgreSQL 17 to the
exact versions CI uses. mise (`mise install`) reads the same file.

**3. Manual install.**

### Prerequisites

- Ruby 3.4.7 (via rbenv, rvm, asdf, or mise)
- Node.js 22.13.0 (via nvm, fnm, asdf, or mise)
- Yarn 1.22+
- **PostgreSQL 17** with PostGIS 3.5+ (PG 16 and earlier will not work
  — `backend/db/structure.sql` uses `transaction_timeout` which is a
  PG17-only configuration parameter; older psql binaries fail with
  `unrecognized configuration parameter` on `db:schema:load`).

### macOS Quick Setup

```bash
# PostgreSQL + PostGIS — must be 17.x specifically
brew install postgresql@17 postgis
brew services start postgresql@17
# Confirm the right psql is on PATH (asdf/mise users skip this):
psql --version  # must report "psql (PostgreSQL) 17.x"

# Ruby + Node
rbenv install 3.4.7
nvm install 22.13.0
```

If `psql --version` reports 14.x or 16.x, prepend the PG17 binary
path before any backend command:

```bash
PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH" bundle exec rails db:schema:load
```

### Backend

```bash
cd backend
bundle install
cp .env.example .env                    # then fill in SECRET_KEY_BASE
bin/rails secret                        # generates a key — paste into .env
bin/rails db:create db:migrate db:seed
bin/rails dev:seed_dynamic              # populate incidents/alerts/risk snapshots — without this the dashboard looks dead
bundle exec rails server                # config/initializers/development_defaults.rb sets DATABASE_PORT=5434 + SSE caps automatically
```

> `dev:seed_dynamic` runs the correlation engine, geofence-breach service, risk
> snapshot job, and recommendation generator over the seeded data. Production
> generates this dynamically via Solid Queue jobs, but locally you'd start with
> an empty dashboard until those jobs ran for hours. The task is idempotent —
> safe to re-run after `git pull` to refresh the demo state.

### Frontend

```bash
cd frontend
yarn install
yarn dev                                # opens on http://localhost:5173
```

### Docker (alternative)

```bash
docker compose up                       # opens on http://localhost:3000
```

## Running Tests

```bash
# Backend — full suite
cd backend && bundle exec rspec

# Backend — security scan
bundle exec brakeman --no-progress -q
bundle exec bundler-audit check

# Frontend — type check + lint + unit tests
cd frontend
npx tsc --noEmit
yarn lint
npx vitest run

# Frontend — production build (stricter than --noEmit)
yarn build
```

All tests must pass before pushing. CI runs the same gates.

## CI Pipeline

Push to `main` triggers 5 parallel test jobs + auto-deploy:

1. **Frontend** -- TypeScript, ESLint, Vitest, production build
2. **Backend Security** -- Brakeman + bundler-audit
3. **Backend Tests** -- RSpec against PostGIS 17
4. **Globe Benchmark** -- Playwright performance budget
5. **E2E** -- Playwright critical-path scenarios

All green triggers automatic deployment to Fly.io.

## Code Conventions

- **Backend:** Service objects for business logic, Pundit policies for authorization, `Audit::EventWriter` for every state mutation
- **Frontend:** TanStack Query for server state, custom hooks for data access, Blueprint.js for UI components
- **Testing:** RSpec request specs for API coverage, Vitest + Testing Library for frontend, Playwright for E2E
- **Authorization:** Every new endpoint must have a Pundit policy. `verify_authorized` after-action enforces this.

## Commit Style

Use concise, imperative commit messages:

```
Fix correlation cooldown race in concurrent workers
Add vessel loitering detection with configurable thresholds
```

## Pull Requests

- Keep PRs focused on a single concern
- Include test coverage for new behavior
- Ensure all CI gates pass before requesting review
