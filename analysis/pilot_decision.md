# BehaviorSpace pilot and Nov 2 slot-model decision

**Decision (2026-10-27, deadline 2026-11-02):** Keep the 12-slot gym model.

The 12-slot model completed a 3x3 x 5-seed BehaviorSpace pilot with finite, non-degenerate reporters, and the timed run scales to a 30-seed grid inside the week-3 window. Keep the slot model; do not fall back to single-slot El Farol.

## What was run

- Experiment: `info-memory-pilot` in `netlogo/experiments.xml`
- Factors: `info-mode` in {none, live, delayed} × `memory-size` in {1, 5, 10}
- Repetitions: 5 seeds (full grid will use 30)
- Each run: 40 days = 480 ticks, first 10 days discarded as burn-in
- Fixed: `n-agents` = 100, `capacity` = 38, `number-strategies` = 10, `delay` = 2, `must-go?` = false, `seed-from-data?` = true, `visualize?` = false
- Completed runs: 45 / 45
- Wall time: 23.1 s (0.51 s/run, ~2.3 min for 30 seeds)
- Flags: none

## Mean % of slots over capacity

| memory-size | none | live | delayed |
|---:|---:|---:|---:|
| 1 | 50.000 | 73.222 | 64.444 |
| 5 | 83.611 | 95.278 | 96.889 |
| 10 | 97.778 | 98.889 | 98.556 |

## Mean peak occupancy

| memory-size | none | live | delayed |
|---:|---:|---:|---:|
| 1 | 78.800 | 72.200 | 76.400 |
| 5 | 65.400 | 61.600 | 62.400 |
| 10 | 63.200 | 53.600 | 59.200 |

## Mean lag-1 autocorrelation

| memory-size | none | live | delayed |
|---:|---:|---:|---:|
| 1 | 0.836 | 0.727 | 0.789 |
| 5 | 0.844 | 0.725 | 0.771 |
| 10 | 0.776 | 0.827 | 0.731 |

## Information main effects (mean over memory-size and seeds)

| metric | none | live | delayed | live − none | delayed − none |
|---|---:|---:|---:|---:|---:|
| pct-slots-over-capacity | 77.130 | 89.130 | 86.630 | 12.000 | 9.500 |
| peak-occupancy | 69.133 | 62.467 | 66.000 | -6.667 | -3.133 |
| occupancy-variance | 273.662 | 138.183 | 147.147 | -135.479 | -126.515 |
| lag1-autocorr | 0.819 | 0.760 | 0.764 | -0.059 | -0.055 |
| good-visit-rate | 0.103 | 0.053 | 0.067 | -0.051 | -0.036 |
| skip-rate | 0.496 | 0.501 | 0.478 | 0.005 | -0.018 |

## How this answers the proposal question (pilot only)

These are 5-seed means, not the 30-seed confirmatory runs. Direction:

- Does `live` reduce overcrowding vs `none`? Δ % over capacity = 12.000; Δ peak = -6.667.
- Does `delayed` look more oscillatory? Δ lag-1 autocorr = -0.055; Δ variance = -126.515.

Memory-size is the larger factor in this pilot: `memory-size` = 1 has lower over-capacity % and much higher occupancy variance than 5 or 10. `live` lowers the evening peak relative to `none` but raises the share of slots over capacity (crowding is flatter, not rarer). `delayed` does **not** raise lag-1 autocorrelation or variance vs `none`. Week-3 30-seed runs should treat that as a hypothesis, not a result.

A few compile fixes were required before headless NetLogo 7.0.4 would load the model: `dx`/`dy` locals renamed (`dx` is a primitive), `report` moved out of `carefully`, BehaviorSpace XML updated to the NetLogo 7 schema (`timeLimit` attribute, `<metrics>` / `<constants>` wrappers), and runs staged to `C:\Temp\gym-elfarol-bs` because this NetLogo 7.0.4 headless build drops path arguments after the first space. `--setup-file` is unused; experiments live in `GymElFarol.nlogox`.

## Gate used

Keep the slot model if and only if the 45-run table is complete, reporters are finite and not collapsed, and the timed pilot implies the 30-seed grid finishes in under ~45 minutes of wall time (week 3, Nov 9–15). Otherwise use the plan's single-slot fallback: one Thursday-style El Farol game whose `info-mode` signal is yesterday's final count vs a delayed/noisy copy.

## Reproduce

```
python analysis/run_pilot.py --experiment info-memory-pilot
python analysis/analyze_pilot.py
```
