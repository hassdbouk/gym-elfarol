# Info x memory grid: section 5 results

- Input table: `info-memory-pilot.csv`
- Runs: 45; population seeds: 5
- Design warnings: none

## 1. Information contrasts (paired by population seed)

Difference = condition minus `none`, same seed and memory size. 95% t-interval across seeds (n-1 df). `clear` = interval does not include 0.

### pct-slots-over-capacity (primary)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 5 | 3.054 | 0.664 | 5.443 | clear |
| 1 | delayed - none | 5 | 2.946 | 1.757 | 4.135 | clear |
| 5 | live - none | 5 | 1.613 | 0.268 | 2.958 | clear |
| 5 | delayed - none | 5 | 2.602 | 1.239 | 3.965 | clear |
| 10 | live - none | 5 | 1.462 | -0.439 | 3.364 |  |
| 10 | delayed - none | 5 | 1.677 | -0.207 | 3.562 |  |

### peak-occupancy (primary)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 5 | 11.800 | -13.225 | 36.825 |  |
| 1 | delayed - none | 5 | 23.600 | 1.869 | 45.331 | clear |
| 5 | live - none | 5 | -0.800 | -9.008 | 7.408 |  |
| 5 | delayed - none | 5 | -2.800 | -14.819 | 9.219 |  |
| 10 | live - none | 5 | -0.400 | -8.757 | 7.957 |  |
| 10 | delayed - none | 5 | -0.600 | -12.529 | 11.329 |  |

### occupancy-variance (supporting)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 5 | 25.691 | -12.016 | 63.398 |  |
| 1 | delayed - none | 5 | 52.483 | 1.948 | 103.019 | clear |
| 5 | live - none | 5 | -0.481 | -23.766 | 22.804 |  |
| 5 | delayed - none | 5 | 2.315 | -18.809 | 23.439 |  |
| 10 | live - none | 5 | -1.645 | -13.705 | 10.416 |  |
| 10 | delayed - none | 5 | 1.211 | -13.761 | 16.182 |  |

### lag1-autocorr (supporting)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 5 | -0.083 | -0.160 | -0.006 | clear |
| 1 | delayed - none | 5 | -0.012 | -0.053 | 0.029 |  |
| 5 | live - none | 5 | -0.066 | -0.138 | 0.006 |  |
| 5 | delayed - none | 5 | -0.008 | -0.071 | 0.055 |  |
| 10 | live - none | 5 | -0.068 | -0.127 | -0.009 | clear |
| 10 | delayed - none | 5 | -0.032 | -0.074 | 0.010 |  |

### good-visit-rate (supporting)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 5 | -0.079 | -0.124 | -0.033 | clear |
| 1 | delayed - none | 5 | -0.077 | -0.107 | -0.048 | clear |
| 5 | live - none | 5 | -0.027 | -0.069 | 0.016 |  |
| 5 | delayed - none | 5 | -0.059 | -0.099 | -0.019 | clear |
| 10 | live - none | 5 | -0.018 | -0.067 | 0.030 |  |
| 10 | delayed - none | 5 | -0.029 | -0.065 | 0.006 |  |

### skip-rate (supporting)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 5 | -0.082 | -0.106 | -0.057 | clear |
| 1 | delayed - none | 5 | -0.086 | -0.105 | -0.067 | clear |
| 5 | live - none | 5 | -0.076 | -0.098 | -0.053 | clear |
| 5 | delayed - none | 5 | -0.081 | -0.101 | -0.061 | clear |
| 10 | live - none | 5 | -0.070 | -0.083 | -0.056 | clear |
| 10 | delayed - none | 5 | -0.072 | -0.088 | -0.056 | clear |

### day-to-day-change (supporting)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 5 | 1.630 | 0.754 | 2.505 | clear |
| 1 | delayed - none | 5 | 2.272 | 0.742 | 3.803 | clear |
| 5 | live - none | 5 | 0.686 | -0.289 | 1.661 |  |
| 5 | delayed - none | 5 | 0.664 | -0.170 | 1.498 |  |
| 10 | live - none | 5 | 0.659 | -0.032 | 1.350 |  |
| 10 | delayed - none | 5 | 0.462 | -0.335 | 1.259 |  |

## 2. Memory x information: cell means

### Mean pct-slots-over-capacity

| memory-size | none | live | delayed |
|---|---|---|---|
| 1 | 8.796 | 11.849 | 11.742 |
| 5 | 5.183 | 6.796 | 7.785 |
| 10 | 4.903 | 6.366 | 6.581 |

### Mean peak-occupancy

| memory-size | none | live | delayed |
|---|---|---|---|
| 1 | 86.200 | 98.000 | 109.800 |
| 5 | 68.400 | 67.600 | 65.600 |
| 10 | 62.000 | 61.600 | 61.400 |

## 3. Validation ("none" condition only)

Profile MAE: simulated and real slot profiles each divided by their own mean. Peak hour: slots grouped by hour as in `calibrate.py`. CV = sqrt(occupancy-variance) / mean-occupancy per run. pct-slots-over-capacity is not used (N was calibrated to it).

| memory-size | n_runs | profile_mae_normalized | sim_peak_hour | real_peak_hour | seeds_peaking_at_real_hour | sim_lag1_mean | sim_lag1_sd | real_lag1 | sim_cv_mean | sim_cv_sd | real_cv |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 5 | 0.385 | 20:00 | 17:00 | 0/5 | 0.518 | 0.040 | 0.870 | 0.679 | 0.031 | 0.294 |
| 5 | 5 | 0.358 | 20:00 | 17:00 | 1/5 | 0.507 | 0.060 | 0.870 | 0.505 | 0.076 | 0.294 |
| 10 | 5 | 0.351 | 20:00 | 17:00 | 1/5 | 0.473 | 0.043 | 0.870 | 0.465 | 0.053 | 0.294 |

## 4. Comparison with the random-choice null

| info-mode | memory-size | n_runs | pct-slots-over-capacity | null_pct_over_capacity | pct_over_minus_null |
|---|---|---|---|---|---|
| none | 1 | 5 | 8.796 | 1.900 | 6.896 |
| none | 5 | 5 | 5.183 | 1.900 | 3.283 |
| none | 10 | 5 | 4.903 | 1.900 | 3.003 |
| live | 1 | 5 | 11.849 | 1.900 | 9.949 |
| live | 5 | 5 | 6.796 | 1.900 | 4.896 |
| live | 10 | 5 | 6.366 | 1.900 | 4.466 |
| delayed | 1 | 5 | 11.742 | 1.900 | 9.842 |
| delayed | 5 | 5 | 7.785 | 1.900 | 5.885 |
| delayed | 10 | 5 | 6.581 | 1.900 | 4.681 |

## Files

- Summary table: `data/processed/grid_summary.csv` (one row per condition)
- Figure: `grid_heatmap_pct_over_capacity.png`
- Figure: `grid_heatmap_peak_occupancy.png`
- Figure: `grid_validation_profile.png`
