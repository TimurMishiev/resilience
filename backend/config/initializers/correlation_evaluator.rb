# Correlation evaluation is handled by Correlations::EvaluateRecentJob,
# scheduled as a Solid Queue recurring task in config/recurring.yml
# (every 10 seconds).
#
# See: app/jobs/correlations/evaluate_recent_job.rb
