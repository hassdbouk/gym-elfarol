# Individual gym schedules and preferences

Implemented from the group input confirmed on November 9, 2026. The default population is 100 agents. Each agent has one availability group, time preference, flexibility level, and crowding preference. These are modeling assumptions, not surveyed student schedules.

## Confirmed profiles

| Availability group | Allowed workout windows |
| --- | --- |
| 1 | 06:30-09:00 and 17:00-22:00 |
| 2 | 09:00-12:00 and 14:00-22:00 |
| 3 | 06:30-22:00 |
| 4 | 10:00-15:00 and 18:00-21:00 |

Time preferences are Morning (06:30-12:00), Night (17:00-22:00), Afternoon (12:00-17:00), and Whenever. Preference applies to the workout **start**, with the end of each preferred period exclusive. Flexibility extends the preferred start period by one hour, three hours, zero, or any available time. For example, a morning agent with one-hour flexibility may start as late as 12:30. Availability always takes priority.

Workouts last one hour, or two half-hour slots. The complete workout must fit inside one availability window and end by closing. An 08:30 start cannot cross group 1's 09:00 boundary. A workout cannot bridge the gap between two windows. The last possible gym-wide start is 21:00.

Crowding types are No difference, Likes it busy, and Likes it empty. They rank feasible predicted loads differently, but none deliberately chooses a forecast above capacity under the default `must-go? = false` setting. Simultaneous decisions can still produce actual over-capacity occupancy. Physical capacity is common to all agents.

The canonical profile definitions are `web/profile-rules.csv`. Both implementations read this file. Browser seed history is served directly from `netlogo/seed_history.csv`; it is not a second hard-coded copy.

## Decision rule

At each slot, agents whose workout has ended leave first. Agents who have not visited consider their remaining allowed start slots:

1. The current slot's prediction comes from that agent's best linear predictor, with the existing 50/50 live or delayed information blend. A missing early-day information signal falls back to the inductive prediction.
2. Future candidate slots use their historical mean over the chosen memory length. Agents never see future actual occupancy. These estimates are refreshed when the next slot is reached.
3. Predictions are bounded to zero through population size. Starts predicted to exceed capacity are excluded.
4. Candidate score is `crowding direction * predicted occupancy / capacity - time cost`. Direction is 0 for indifferent, +1 for busy-seeking, and -1 for quiet-seeking. Time cost is the distance outside the preferred start period divided by the flexibility allowance. Unlimited flexibility uses the 930-minute operating span; Whenever has zero time cost. This equal weighting is an explicit implementation assumption.
5. The agent attends if the current slot is its highest-scoring remaining candidate; otherwise it waits. Fixed, independently generated per-agent slot priorities break ties and prevent shared labels from forcing identical choices.

Zero-flexibility agents never start outside their preferred period. Unlimited flexibility allows movement within availability while preserving a soft preference for the named period. An agent with no feasible start skips; its availability is not silently changed. `must-go?`, if deliberately enabled in NetLogo, forces attendance only at that agent's final allowed start, never outside availability.

## Occupancy and visit accounting

Agents remain in the gym for exactly two slots and can start at most one workout per day. They contribute to occupancy in both occupied slots. A successful visit must remain at or below capacity throughout the workout. A crowded first slot cannot be overwritten by a quieter later slot. Each visit or skip is counted once at day end. Lag-1 autocorrelation excludes overnight closing-to-opening pairs, matching the real-data calibration convention.

This fixes the prior NetLogo behavior in which `attend?` remained true until the next day. Old pilot results therefore do not validate the new model.

## Balanced and reproducible populations

There are 4 x 4 x 4 x 3 = 192 possible profile combinations. With 100 agents, the default allocation is:

- 25 agents per availability group;
- 25 per time preference, with six or seven of each preference inside each availability group;
- 25 per flexibility level;
- 33 or 34 per crowding type.

Assignments are randomized subject to these marginal counts. This does not fully balance all 192 joint combinations. The population seed controls profile assignments and tie priorities, independently of the strategy seed and memory length. Attributes stay fixed throughout a run. Both implementations use the same specified Park-Miller generator for profiles and linear-strategy weights so matching configurations can be checked directly.

BehaviorSpace varies population seeds 1-5 for the pilot and 1-30 for the full grid, with one run per explicit seed per condition. Strategy seed is `100000 + population-seed`. Thus the same population is reused across information and memory conditions: 45 pilot runs and 270 full-grid runs. Each run lasts 40 days; the first 10 are discarded. Population and strategy seeds are recorded in the output. Use a new population seed to explore a new assignment; do not change it when comparing conditions for the same replicate.

In the browser, select an agent for its complete profile and allowed starts. Download agent profiles to retain the exact assignments, rules, and tie priorities. In the NetLogo Command Center, `export-agent-profiles "profiles.csv"` exports the current assignment.

## Running and verifying

From the repository root:

```text
python web/server.py
node --test tests/simulation.test.js
python tests/check_model_config.py
python analysis/run_pilot.py --smoke
python analysis/run_pilot.py --experiment info-memory-pilot --threads 4
node tests/check_netlogo_parity.js data/processed/preferences_pilot.csv
```

The browser runs at http://127.0.0.1:8000. Use Reset to replay the same seeds. Changing information, memory, population size, capacity, days, or seeds resets the run. The browser stops after exactly the requested number of days. Speed changes do not reset the experiment.

Open `netlogo/GymElFarol.nlogox` with NetLogo 7.0.4. The older `.nlogo` file is retained as a legacy version and does not contain these changes. The runner accepts `--netlogo PATH` or `NETLOGO_HOME` if NetLogo is not in its usual installation directory. It stages the include file and shared CSV rules alongside the model.

New results use `preferences_smoke.csv`, `preferences_pilot.csv`, or `preferences_info-memory-grid.csv`. Run metadata is stored beside each table as `.meta.json`, including hashes of the model, include, rule CSV, and seed CSV. The original pilot CSV and summary are retained as historical artifacts. `analysis/analyze_pilot.py` remains the older slot-model decision analysis; its fixed narrative and default output names should not be used as the new preference experiment report.

## Calibration of scale, seed history and population size

**Scale.** Real 3WR+4WR counts are scaled so that the observed 95th percentile (236 people, regular-term Mon-Thu 06:30-22:00) equals the model capacity of 37 agents: scale = 37/236. Capacity is therefore the real p95, and the real share of slots over capacity (4.89%) is about 5% by construction. Matching it means the model's own p95 is close to capacity.

**Seed history** (`analysis/calibrate.py`, written to `netlogo/seed_history.csv`). Each slot's pooled Mon-Thu mean is shrunk toward its nearest observed neighbouring slots, and each weekday mean toward that shrunk slot mean, by observation count: (n x mean + k x prior)/(n + k), k = 5. Every slot gets the same four Mon-Thu values, so no slot is seeded with a single repeated number. 06:30 has no observations and uses its neighbour estimate; it is flagged `filled=True, n_obs=0`. Friday is left out because the gym closes at 20:00. `reference_n` records the population the seed values correspond to. With `scale-seed-with-n?` on (the default), both engines multiply the seeds and the real comparison curve by n-agents / reference_n, so another N keeps the same per-agent demand. `capacity-from-ratio?` with `capacity-ratio` (default 10.88%) does the same for capacity.

**Population size N** (`analysis/calibrate_n.js`, results in `data/processed/calibration_n.json` and `.csv`). The utility rule with default weights is run under information **none** only, memory 1/5/10 and population seeds 1-30, for 50 days with 20 burn-in. A coarse grid covers N = 250-500 in steps of 25, then a step-5 grid covers the bracketing interval. N* is where the mean percentage of slots over capacity crosses the real 4.89%, by linear interpolation: **N* = 340**, with a per-seed 95% range of 330-349. The occupancy-profile RMSE against the real curve is a check, not a target. It is lowest near this N (about 6.3 agents). The pooled 4.9% hides a large memory effect. At N = 340 the share over capacity is 10.4% with memory 1, 2.9% with memory 5 and 1.3% with memory 10. Memory is an experimental factor, so the calibration averages over it rather than matching any single level. Live and delayed runs are never used for calibration. Re-run both scripts if the decision rule or its default weights change.

**Profile mix (option).** `profile-mix = "demand-weighted"` draws availability and preference jointly from `web/profile-mix.csv`. Those shares come from a non-negative least-squares fit of the 16 availability x preference cells to the shape of the real curve, assuming an even choice among each cell's allowed starts, with a ridge penalty toward balanced shares (0.03). Without the penalty, about 93% of agents fall into the all-day group. The fit lowers the relative curve-shape error from 0.36 (balanced) to 0.14. The main experiments stay balanced, because fitting the mix to the same curve used to judge shape would be circular.

## Research limitations to resolve before conclusions

Do not tune capacity, N, or weights to manufacture a desired information effect. Balanced profile proportions and the utility weights are assumptions. Later sensitivity analyses can vary them. The existing Word report and progress summary still contain older model descriptions and should be updated by the group to describe the final implementation and its limitations.
