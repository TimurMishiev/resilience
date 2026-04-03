# Feed ingestion is now managed by Solid Queue recurring jobs.
#
# See:
#   app/jobs/feeds/poll_job.rb  — unified poll job for all 7 feeds
#   config/recurring.yml        — schedule configuration per feed
#
# The previous boot-time thread architecture has been replaced. Benefits:
#   - Job-level retry with exponential backoff (ActiveJob retry_on)
#   - Observability through Solid Queue's jobs table
#   - No thread-per-feed connection pool pressure
#   - Consistent scheduling that survives process restarts
#   - Dead-letter handling via Solid Queue's failed job tracking
#
# Feed schedules:
#   opensky  — every 15 min  (aircraft positions, OpenSky Network)
#   usgs     — every 5 min   (seismic events, USGS FDSN)
#   gpsjam   — every 15 min  (GPS interference, gpsjam.org)
#   ais      — every 30 sec  (vessel positions, AIS Hub — requires AISHUB_USERNAME)
#   firms    — every 15 min  (wildfire hotspots, NASA FIRMS — requires NASA_FIRMS_MAP_KEY)
#   gdacs    — every 15 min  (disaster alerts, GDACS UN)
#   acled    — every hour    (conflict events, ACLED — requires ACLED_API_KEY + ACLED_EMAIL)
