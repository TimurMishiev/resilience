# Strong Migrations — production-scale migration safety guardrail.
#
# Baselined at the timestamp of the latest existing migration so historical
# migrations are never retroactively scanned. Any migration created after this
# point is validated for unsafe patterns (non-concurrent index adds, NOT NULL
# column adds, long-held locks, etc.) before it runs in any environment.
#
# When adding a new migration, bump this value only if you are consciously
# accepting that older baselines will stop being validated. Do not bump it to
# silence a warning about the newest migration — fix the migration instead.
StrongMigrations.start_after = 20260415100001
