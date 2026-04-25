# ADR-008: Trust Model — Smooth Falloff + Source Reliability Priors

**Status:** Accepted (v1 shipped; feedback loop deferred to v2)
**Date:** 2026-04-25

## Context

The third-pass CTO review flagged the correlation-engine confidence
score as "the most domain-interesting feature [that is] the least
rigorously engineered." Two specific concerns:

1. **Linear proximity falloff with hard zero.** The previous
   `proximity_confidence` was `(1.0 - actual_km / proximity_km).clamp(0, 1)`,
   which produces a step function at the boundary:

   | distance | old confidence |
   |---|---|
   | 0 km     | 1.000 |
   | 25 km (of 50) | 0.500 |
   | 49.9 km  | 0.002 |
   | 50.1 km  | 0.000 ← step |
   | 100 km   | 0.000 |
   | 1000 km  | 0.000 |

   A signal just outside the boundary scored identically to a signal
   on the other side of the planet. No real operational distance
   model has that shape.

2. **No source-trust weighting.** A USGS seismic signal and an ACLED
   human-curated event scored identically for the same proximity and
   rule. In reality, USGS is authoritative for seismic events;
   ACLED has days-to-weeks lag and manual curation error. An honest
   trust model would treat them differently.

The previous Reviewer 1 framing: *"the most domain-interesting feature
is the most naive."* They were right.

## Decision

Two changes shipped in this ADR. A third (feedback loop) is
documented as v2.

### Change 1 — Smooth logistic falloff

`proximity_confidence` is now:

```ruby
PROXIMITY_LOGISTIC_K = 6.0

def proximity_confidence(proximity_km, actual_km)
  return 1.0 if proximity_km.zero?
  ratio = actual_km / proximity_km
  1.0 / (1.0 + Math.exp(PROXIMITY_LOGISTIC_K * (ratio - 0.5)))
end
```

The curve passes through `(ratio=0.5, conf=0.5)` and gives
approximately `0.95` at the site centre, `0.05` at the proximity
boundary, with smooth tails outside. Concretely:

| ratio (actual/proximity) | new confidence |
|---|---|
| 0.0  | 0.953 |
| 0.25 | 0.818 |
| 0.50 | 0.500 |
| 0.75 | 0.182 |
| 1.00 | 0.047 ← knee, not cliff |
| 1.25 | 0.012 |
| 2.00 | 0.000 |

**Why logistic and not Gaussian, exponential, or power-law:**

- Logistic has a natural "knee" location (ratio=0.5) that operators
  can reason about: "this is the half-confidence distance."
- Gaussian's tail falls off too aggressively for operational use —
  a signal 10% past the boundary would score ~0.0001 (effectively zero).
- Exponential has no inflection point; feels less like a calibrated
  threshold and more like a decay.
- The `k = 6.0` steepness is chosen empirically so the 5/95
  confidence boundary coincides with the `proximity_km` parameter —
  preserving existing operator mental models about what "50 km
  proximity" means.

### Change 2 — Per-source reliability priors

A `SOURCE_RELIABILITY` constants table now multiplies the aggregated
condition confidence:

```ruby
SOURCE_RELIABILITY = {
  "usgs_seismic"  => 1.00,  # authoritative; minimal noise
  "nasa_firms"    => 0.95,  # satellite-derived, small lag
  "derived"       => 0.95,  # internally computed (AIS gap, loiter) — well-tested
  "opensky"       => 0.90,  # crowd ADS-B, occasionally spoofed
  "ais_hub"       => 0.85,  # AIS — spoofable, generally reliable
  "gdacs"         => 0.85,  # multi-agency disaster aggregator
  "gpsjam"        => 0.75,  # crowd GPS jamming, detection-rate-bound
  "acled"         => 0.70,  # human-curated, days-to-weeks lag
}.freeze
DEFAULT_SOURCE_RELIABILITY = 0.50
```

**Calibration rationale:**

- **USGS (1.00)** — scientific instrument network, global coverage,
  authoritative source for seismic events. No penalty.
- **NASA FIRMS (0.95)** — satellite thermal-anomaly detection. Small
  lag (15-min to 3-hour), occasional false positives from hot
  industrial sources or large fires misclassified. Slight penalty.
- **derived (0.95)** — internally computed signals (AIS gaps,
  loiter detection, etc). We trust our own code path, but not as
  much as a direct upstream observation.
- **OpenSky (0.90)** — crowd-contributed ADS-B receivers. Mostly
  reliable in Europe/North America; gaps in coverage elsewhere.
  ADS-B can be spoofed but rarely is.
- **AIS Hub (0.85)** — vessel AIS broadcasts. Spoofable (a real
  operational concern in contested maritime areas), intentionally
  turned off by some actors. Still our primary maritime signal.
- **GDACS (0.85)** — multi-agency aggregation (USGS, WHO, NOAA,
  etc). Mostly authoritative but can echo the underlying sources'
  noise plus aggregation lag.
- **GPSJam (0.75)** — crowd GPS-jamming detection. Low false-
  positive rate in detected areas, but detection depends on flights
  passing through a jamming zone — missed-detection risk.
- **ACLED (0.70)** — human-curated conflict events. Authoritative
  for what it reports, but lag of days to weeks and coverage biased
  by reporter availability.
- **Default (0.50)** — a new feed that hasn't been calibrated gets
  a neutral prior. Prevents accidentally inheriting high trust by
  adding a new source without thinking about its reliability.

The source weight multiplies the post-aggregation confidence, not
per-condition, because corroboration across feeds is already
captured in the AND/OR aggregation — double-weighting would punish
well-corroborated rules unfairly.

### What v2 will add: feedback loop

Not in v1:

- **Confirmed / rejected feedback** — when an operator triages an
  alert, we record whether they confirmed or dismissed it, and the
  model learns to adjust the per-source prior based on false-positive
  rates. Requires a `signal_rule_match_outcomes` table, a cron job
  that recomputes priors on a rolling window, and a dashboard.
- **Rule-specific calibration** — some rules are known to over-fire
  (e.g., "any AIS gap near a port" fires constantly during normal
  operations). Per-rule adjustment multipliers would let operators
  tune without writing code.
- **Time-of-day / seasonality priors** — ACLED lag means events
  reported this week mostly happened last week. A temporal prior
  could account for this.

These are deferred because they require schema work (the outcomes
table), product work (operator triage UX), and an analytics infra
decision (where do the aggregates live — OLAP store, cached
calculation, etc).

## Consequences

- **Operator-visible behaviour changes.** Confidence scores on
  existing signals will shift: USGS signals stay about the same,
  ACLED signals drop to 70% of their previous value, boundary-
  proximity signals stop scoring near-1.0 then jumping to 0. This
  is a breaking change in the confidence-to-operator-action mapping
  — any operator habit ("I acknowledge anything above 0.8") needs
  recalibration.
- **Rule creators think about source.** Writing a rule that only
  fires on ACLED signals now has a baked-in 30% confidence
  discount. Creators can compensate by setting lower confidence
  thresholds on the rule.
- **New feeds need calibration.** Adding an eighth feed means
  adding an entry to `SOURCE_RELIABILITY`. An unknown source gets
  0.50 — reasonable neutral prior, but a deliberate choice rather
  than accidental inheritance.
- **Testing surface grows.** Three new spec cases prove the curve
  shape, the smooth-boundary behaviour, and the source-prior
  multiplication. Regression spec for the exact step-function bug
  the reviewer identified is now pinned.

## What this is NOT

- **Not a calibrated classifier with training data.** The source
  priors are expert-set constants informed by public literature on
  each feed's accuracy, not fitted from labelled operational data.
  A proper calibration would require months of operator-confirmed
  triage data (see v2 feedback loop).
- **Not a replacement for operator judgment.** Confidence is a
  ranking signal, not a go/no-go gate. Every alert still requires
  operator triage; confidence helps prioritise the queue.
- **Not a formal probability.** The numbers are in [0, 1] but they
  are not well-calibrated probabilities (P(real-threat | alert)).
  They are a heuristic ranking. Treating them as Bayesian posteriors
  would overstate what the math produces.
- **Not a defence against adversarial data.** A spoofed AIS signal
  with an "ais_hub" source scores 0.85 like any other AIS signal.
  Adversarial-data defence is a separate concern addressed in
  ADR-009 (adversarial threat model).
