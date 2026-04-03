# Correlation evaluation is now handled by Correlations::EvaluateRecentJob,
# scheduled as a Solid Queue recurring task in config/recurring.yml
# (every 10 seconds).
#
# The previous implementation used a boot-time Thread (BackgroundEvaluator)
# that held a persistent DB connection. The job-based approach gives us:
#   - Job-level retry with exponential backoff
#   - Observability through Solid Queue's jobs table
#   - No persistent thread holding a DB connection
#   - Consistent scheduling that survives process restarts
#
# See: app/jobs/correlations/evaluate_recent_job.rb
# See: app/services/correlations/background_evaluator.rb (legacy, retained for reference)
