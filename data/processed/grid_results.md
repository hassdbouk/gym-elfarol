# Info x memory grid: section 5 results

- Input table: `info-memory-grid.csv`
- Runs: 270; population seeds: 30
- Design warnings: none

## 1. Information contrasts (paired by population seed)

Difference = condition minus `none`, same seed and memory size. 95% t-interval across seeds (n-1 df). `clear` = interval does not include 0.

### pct-slots-over-capacity (primary)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 30 | -1.179 | -1.790 | -0.569 | clear |
| 1 | delayed - none | 30 | -1.423 | -2.172 | -0.674 | clear |
| 5 | live - none | 30 | 4.832 | 4.269 | 5.395 | clear |
| 5 | delayed - none | 30 | 5.140 | 4.679 | 5.601 | clear |
| 10 | live - none | 30 | 5.355 | 4.892 | 5.818 | clear |
| 10 | delayed - none | 30 | 5.057 | 4.591 | 5.523 | clear |

### peak-occupancy (primary)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 30 | -12.767 | -16.582 | -8.951 | clear |
| 1 | delayed - none | 30 | 5.467 | -0.189 | 11.123 |  |
| 5 | live - none | 30 | 11.600 | 8.274 | 14.926 | clear |
| 5 | delayed - none | 30 | 12.200 | 8.922 | 15.478 | clear |
| 10 | live - none | 30 | 13.667 | 11.057 | 16.277 | clear |
| 10 | delayed - none | 30 | 11.900 | 9.691 | 14.109 | clear |

### occupancy-variance (supporting)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 30 | -34.853 | -46.666 | -23.040 | clear |
| 1 | delayed - none | 30 | 22.998 | 13.052 | 32.944 | clear |
| 5 | live - none | 30 | 25.547 | 21.601 | 29.493 | clear |
| 5 | delayed - none | 30 | 33.352 | 29.744 | 36.961 | clear |
| 10 | live - none | 30 | 24.345 | 20.969 | 27.721 | clear |
| 10 | delayed - none | 30 | 24.607 | 21.775 | 27.438 | clear |

### lag1-autocorr (supporting)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 30 | -0.201 | -0.220 | -0.182 | clear |
| 1 | delayed - none | 30 | -0.105 | -0.120 | -0.089 | clear |
| 5 | live - none | 30 | -0.115 | -0.132 | -0.099 | clear |
| 5 | delayed - none | 30 | -0.066 | -0.081 | -0.051 | clear |
| 10 | live - none | 30 | -0.102 | -0.120 | -0.084 | clear |
| 10 | delayed - none | 30 | -0.039 | -0.060 | -0.018 | clear |

### good-visit-rate (supporting)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 30 | 0.022 | 0.007 | 0.036 | clear |
| 1 | delayed - none | 30 | 0.017 | 0.001 | 0.034 | clear |
| 5 | live - none | 30 | -0.123 | -0.138 | -0.108 | clear |
| 5 | delayed - none | 30 | -0.124 | -0.135 | -0.112 | clear |
| 10 | live - none | 30 | -0.138 | -0.150 | -0.125 | clear |
| 10 | delayed - none | 30 | -0.122 | -0.135 | -0.109 | clear |

### skip-rate (supporting)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 30 | -0.002 | -0.004 | 0.001 |  |
| 1 | delayed - none | 30 | -0.005 | -0.008 | -0.003 | clear |
| 5 | live - none | 30 | -0.027 | -0.030 | -0.024 | clear |
| 5 | delayed - none | 30 | -0.025 | -0.028 | -0.023 | clear |
| 10 | live - none | 30 | -0.021 | -0.025 | -0.017 | clear |
| 10 | delayed - none | 30 | -0.026 | -0.030 | -0.022 | clear |

### day-to-day-change (supporting)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 30 | -3.224 | -3.733 | -2.715 | clear |
| 1 | delayed - none | 30 | -2.433 | -2.978 | -1.889 | clear |
| 5 | live - none | 30 | 1.095 | 0.798 | 1.392 | clear |
| 5 | delayed - none | 30 | 1.592 | 1.357 | 1.827 | clear |
| 10 | live - none | 30 | 0.803 | 0.600 | 1.007 | clear |
| 10 | delayed - none | 30 | 0.937 | 0.726 | 1.147 | clear |

## 2. Memory x information: cell means

### Mean pct-slots-over-capacity

| memory-size | none | live | delayed |
|---|---|---|---|
| 1 | 19.226 | 18.047 | 17.803 |
| 5 | 5.104 | 9.935 | 10.244 |
| 10 | 2.935 | 8.290 | 7.993 |

### Mean peak-occupancy

| memory-size | none | live | delayed |
|---|---|---|---|
| 1 | 114.967 | 102.200 | 120.433 |
| 5 | 51.567 | 63.167 | 63.767 |
| 10 | 45.667 | 59.333 | 57.567 |

## 3. Validation ("none" condition only)

Profile MAE: simulated and real slot profiles each divided by their own mean. Peak hour: slots grouped by hour as in `calibrate.py`. CV = sqrt(occupancy-variance) / mean-occupancy per run. pct-slots-over-capacity is not used (N was calibrated to it).

| memory-size | n_runs | profile_mae_normalized | sim_peak_hour | real_peak_hour | seeds_peaking_at_real_hour | sim_lag1_mean | sim_lag1_sd | real_lag1 | sim_cv_mean | sim_cv_sd | real_cv |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 30 | 0.287 | 19:00 | 17:00 | 1/30 | 0.567 | 0.036 | 0.870 | 0.719 | 0.036 | 0.294 |
| 5 | 30 | 0.253 | 17:00 | 17:00 | 26/30 | 0.512 | 0.045 | 0.870 | 0.317 | 0.019 | 0.294 |
| 10 | 30 | 0.256 | 17:00 | 17:00 | 24/30 | 0.498 | 0.043 | 0.870 | 0.285 | 0.017 | 0.294 |

## 4. Comparison with the random-choice null

| info-mode | memory-size | n_runs | pct-slots-over-capacity | null_pct_over_capacity | pct_over_minus_null |
|---|---|---|---|---|---|
| none | 1 | 30 | 19.226 | 1.900 | 17.326 |
| none | 5 | 30 | 5.104 | 1.900 | 3.204 |
| none | 10 | 30 | 2.935 | 1.900 | 1.035 |
| live | 1 | 30 | 18.047 | 1.900 | 16.147 |
| live | 5 | 30 | 9.935 | 1.900 | 8.035 |
| live | 10 | 30 | 8.290 | 1.900 | 6.390 |
| delayed | 1 | 30 | 17.803 | 1.900 | 15.903 |
| delayed | 5 | 30 | 10.244 | 1.900 | 8.344 |
| delayed | 10 | 30 | 7.993 | 1.900 | 6.093 |

## Files

- Summary table: `data/processed/grid_summary.csv` (one row per condition)
- Figure: `grid_heatmap_pct_over_capacity.png`
- Figure: `grid_heatmap_peak_occupancy.png`
- Figure: `grid_validation_profile.png`
