# Info x memory grid: section 5 results

- Input table: `info-memory-grid.csv`
- Runs: 270; population seeds: 30
- Design warnings: none

## 1. Information contrasts (paired by population seed)

Difference = condition minus `none`, same seed and memory size. 95% t-interval across seeds (n-1 df). `clear` = interval does not include 0.

### pct-slots-over-capacity (primary)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 30 | 4.014 | 3.259 | 4.770 | clear |
| 1 | delayed - none | 30 | 4.254 | 3.387 | 5.122 | clear |
| 5 | live - none | 30 | 2.229 | 1.493 | 2.965 | clear |
| 5 | delayed - none | 30 | 1.677 | 0.969 | 2.386 | clear |
| 10 | live - none | 30 | 2.312 | 1.607 | 3.017 | clear |
| 10 | delayed - none | 30 | 2.129 | 1.528 | 2.731 | clear |

### peak-occupancy (primary)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 30 | 17.133 | 11.006 | 23.261 | clear |
| 1 | delayed - none | 30 | 23.300 | 16.360 | 30.240 | clear |
| 5 | live - none | 30 | 4.767 | 0.552 | 8.982 | clear |
| 5 | delayed - none | 30 | 6.533 | 2.201 | 10.866 | clear |
| 10 | live - none | 30 | 4.833 | 1.848 | 7.819 | clear |
| 10 | delayed - none | 30 | 5.633 | 2.016 | 9.250 | clear |

### occupancy-variance (supporting)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 30 | 37.315 | 27.525 | 47.104 | clear |
| 1 | delayed - none | 30 | 61.745 | 49.498 | 73.991 | clear |
| 5 | live - none | 30 | 5.850 | -0.460 | 12.161 |  |
| 5 | delayed - none | 30 | 3.714 | -1.164 | 8.591 |  |
| 10 | live - none | 30 | 3.803 | -1.534 | 9.140 |  |
| 10 | delayed - none | 30 | 4.645 | 0.236 | 9.055 | clear |

### lag1-autocorr (supporting)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 30 | -0.072 | -0.090 | -0.054 | clear |
| 1 | delayed - none | 30 | 0.019 | 0.004 | 0.035 | clear |
| 5 | live - none | 30 | -0.074 | -0.092 | -0.056 | clear |
| 5 | delayed - none | 30 | -0.031 | -0.048 | -0.015 | clear |
| 10 | live - none | 30 | -0.077 | -0.095 | -0.058 | clear |
| 10 | delayed - none | 30 | -0.028 | -0.042 | -0.015 | clear |

### good-visit-rate (supporting)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 30 | -0.099 | -0.122 | -0.076 | clear |
| 1 | delayed - none | 30 | -0.110 | -0.138 | -0.082 | clear |
| 5 | live - none | 30 | -0.056 | -0.081 | -0.030 | clear |
| 5 | delayed - none | 30 | -0.042 | -0.065 | -0.018 | clear |
| 10 | live - none | 30 | -0.054 | -0.075 | -0.033 | clear |
| 10 | delayed - none | 30 | -0.049 | -0.065 | -0.033 | clear |

### skip-rate (supporting)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 30 | -0.093 | -0.100 | -0.086 | clear |
| 1 | delayed - none | 30 | -0.096 | -0.103 | -0.088 | clear |
| 5 | live - none | 30 | -0.077 | -0.084 | -0.071 | clear |
| 5 | delayed - none | 30 | -0.079 | -0.084 | -0.074 | clear |
| 10 | live - none | 30 | -0.071 | -0.076 | -0.065 | clear |
| 10 | delayed - none | 30 | -0.072 | -0.079 | -0.066 | clear |

### day-to-day-change (supporting)

| memory-size | contrast | n_seeds | mean_diff | ci_low | ci_high | clear |
|---|---|---|---|---|---|---|
| 1 | live - none | 30 | 2.193 | 1.773 | 2.613 | clear |
| 1 | delayed - none | 30 | 2.999 | 2.430 | 3.568 | clear |
| 5 | live - none | 30 | 0.657 | 0.352 | 0.961 | clear |
| 5 | delayed - none | 30 | 0.673 | 0.455 | 0.891 | clear |
| 10 | live - none | 30 | 0.651 | 0.449 | 0.853 | clear |
| 10 | delayed - none | 30 | 0.507 | 0.313 | 0.701 | clear |

## 2. Memory x information: cell means

### Mean pct-slots-over-capacity

| memory-size | none | live | delayed |
|---|---|---|---|
| 1 | 7.183 | 11.197 | 11.437 |
| 5 | 3.767 | 5.996 | 5.444 |
| 10 | 4.050 | 6.362 | 6.179 |

### Mean peak-occupancy

| memory-size | none | live | delayed |
|---|---|---|---|
| 1 | 80.500 | 97.633 | 103.800 |
| 5 | 59.967 | 64.733 | 66.500 |
| 10 | 58.300 | 63.133 | 63.933 |

## 3. Validation ("none" condition only)

Profile MAE: simulated and real slot profiles each divided by their own mean. Peak hour: slots grouped by hour as in `calibrate.py`. CV = sqrt(occupancy-variance) / mean-occupancy per run. pct-slots-over-capacity is not used (N was calibrated to it).

| memory-size | n_runs | profile_mae_normalized | sim_peak_hour | real_peak_hour | seeds_peaking_at_real_hour | sim_lag1_mean | sim_lag1_sd | real_lag1 | sim_cv_mean | sim_cv_sd | real_cv |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 30 | 0.371 | 20:00 | 17:00 | 3/30 | 0.502 | 0.040 | 0.870 | 0.628 | 0.093 | 0.294 |
| 5 | 30 | 0.343 | 20:00 | 17:00 | 7/30 | 0.517 | 0.050 | 0.870 | 0.473 | 0.058 | 0.294 |
| 10 | 30 | 0.326 | 20:00 | 17:00 | 11/30 | 0.517 | 0.054 | 0.870 | 0.452 | 0.065 | 0.294 |

## 4. Comparison with the random-choice null

| info-mode | memory-size | n_runs | pct-slots-over-capacity | null_pct_over_capacity | pct_over_minus_null |
|---|---|---|---|---|---|
| none | 1 | 30 | 7.183 | 1.900 | 5.283 |
| none | 5 | 30 | 3.767 | 1.900 | 1.867 |
| none | 10 | 30 | 4.050 | 1.900 | 2.150 |
| live | 1 | 30 | 11.197 | 1.900 | 9.297 |
| live | 5 | 30 | 5.996 | 1.900 | 4.096 |
| live | 10 | 30 | 6.362 | 1.900 | 4.462 |
| delayed | 1 | 30 | 11.437 | 1.900 | 9.537 |
| delayed | 5 | 30 | 5.444 | 1.900 | 3.544 |
| delayed | 10 | 30 | 6.179 | 1.900 | 4.279 |

## Files

- Summary table: `data/processed/grid_summary.csv` (one row per condition)
- Figure: `grid_heatmap_pct_over_capacity.png`
- Figure: `grid_heatmap_peak_occupancy.png`
- Figure: `grid_validation_profile.png`
