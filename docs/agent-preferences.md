# Individual gym schedules and preferences

Implemented from the group input confirmed on November 9, 2026. The default population is 340 agents (calibrated; see below). Each agent has one availability group, time preference, flexibility level, and crowding preference. These are modeling assumptions, not surveyed student schedules.

## Confirmed profiles

| Availability group | Allowed workout windows |
| --- | --- |
| 1 | 06:30-09:00 and 17:00-22:00 |
| 2 | 09:00-12:00 and 14:00-22:00 |
| 3 | 06:30-22:00 |
| 4 | 10:00-15:00 and 18:00-21:00 |

Time preferences are Morning (06:30-12:00), Night (17:00-22:00), Afternoon (12:00-17:00), and Whenever. Preference applies to the workout **start**, with the end of each preferred period exclusive. Flexibility extends the preferred start period by one hour, three hours, zero, or any available time. For example, a morning agent with one-hour flexibility may start as late as 12:30. Availability always takes priority.

Workouts last one hour, or two half-hour slots. The complete workout must fit inside one availability window and end by closing. An 08:30 start cannot cross group 1's 09:00 boundary. A workout cannot bridge the gap between two windows. The last possible gym-wide start is 21:00.

Crowding types are No difference, Likes it busy, and Likes it empty. Under the utility rule they shift taste only below capacity; every type pays the same crowding penalty as the forecast nears and passes capacity. Simultaneous decisions can still produce actual over-capacity occupancy. Physical capacity is common to all agents.

The canonical profile definitions are `web/profile-rules.csv`. Both implementations read this file. Browser seed history is served directly from `netlogo/seed_history.csv`; it is not a second hard-coded copy.

## Decision rule

`decision-rule = "utility"` is the model. `"legacy"` keeps the earlier threshold rule unchanged, for before/after comparison (experiment `legacy-baseline`). Both keep the El Farol core: per-slot memory, each agent's bag of random linear predictors chosen by past error, and the none/live/delayed information switch.

**Forecasts.** At the start of each day, every agent forecasts each of its allowed start slots with its best predictor on that slot's own history (yesterday and earlier only). The predictor is `C * c + sum(w_k * x_k)`. The constant is scaled by capacity rather than population, so forecast noise does not grow with N; with the original population scaling, 42% of current-slot forecasts at N = 400 exceeded capacity from noise alone. With `recency-decay` below 1, the error on the day d back is weighted by `decay^(d-1)` when choosing the predictor. All estimates are clipped to [0, N].

**Information.** Live or delayed information changes only the slot being decided: its forecast becomes `0.5 * forecast + 0.5 * observed count` (the count 1 or `delay` slots ago). Later slots keep the day-start forecast in every mode. In words: information tells agents how busy the gym is now; it does not change their beliefs about later today, and agents never see future actual counts.

**Utility.** With load `x = forecast / C`:

```text
P(x)      = ( max(0, x - theta) / (1 - theta) )^2
U_i(s)    = V - wP * P(x) + wC * d_i * min(x, 1) - wT * T_i(s) + wR * R_i(s)
U_i(skip) = 0
```

`d_i` is 0, +1 or -1 for indifferent, busy-liking and quiet-liking agents. `T_i(s)` is the distance outside the preferred start period divided by the flexibility allowance (930 minutes for "any time"; 0 for Whenever). `R_i(s)` is the learned value of the slot (0 unless `outcome-learning?` is on).

| Weight (NetLogo global) | Default | Reason | Sensitivity values |
| --- | --- | --- | --- |
| V `workout-value` | 1 | unit of value; the other weights are relative to it | fixed |
| wP `crowd-penalty` | 1 | at a forecast of C the penalty cancels the workout, so a typical agent is indifferent between a full gym and staying home, as in El Farol | 0.5, 2 |
| theta `comfort-threshold` | 0.8 | the real mean is about 0.67 C, so typical slots carry no penalty | 0.6, 0.9 |
| wT `time-weight` | 0.5 | starting at the edge of one's flexibility costs half a workout | 0.25, 1 |
| wC `taste-weight` | 0.25 | smaller than the penalty, so busy-likers peak at about 0.805 C, below capacity | 0, 0.5 |
| tau `choice-temperature` | 0.1 | a utility gap of 0.1 changes the odds by a factor of e | 0 (argmax), 0.05, 0.25 |
| alpha, wR `learning-rate`, `learning-weight` | 0.2, 0.5 | only with `outcome-learning?` on (off by default) | learning on |

The old filter "never start above capacity" is the limit theta -> 1, wP -> infinity, tau -> 0.

**Choice.** At each slot a waiting agent chooses among {start now, a later allowed start, skip today} with probability `exp(U/tau) / sum exp(U/tau)`. It starts only if it draws "now"; otherwise it waits and decides again at its next allowed start, and at its last allowed start "not now" means skip. If utilities stay fixed during the day, this gives exactly the same distribution as one logit choice over the whole day (tested). The random draw for (agent, day, slot) is a counter-based Park-Miller hash of the strategy seed, so none, live and delayed runs use the same draws and are paired comparisons. With tau = 0 the choice is the argmax, and the fixed per-agent tie priorities break exact ties. `must-go?` makes an agent go at its last allowed start, never outside availability. There is no queue or entry cap: over capacity only makes the visit bad.

**Outcome learning (off by default).** After each visit, `R(s) <- R(s) + alpha * (r - R(s))` for the visited start slot, with r = +1 for a good visit and -1 for a bad one.

Zero-flexibility agents never start outside their preferred period. An agent with no feasible start skips every day (availability "Before and after class" + Afternoon + No change has none); these are reported separately as `structural-skip-rate`.

## Occupancy and visit accounting

Agents remain in the gym for exactly two slots and can start at most one workout per day. They contribute to occupancy in both occupied slots. A successful visit must remain at or below capacity throughout the workout. A crowded first slot cannot be overwritten by a quieter later slot. Each visit or skip is counted once at day end. Lag-1 autocorrelation excludes overnight closing-to-opening pairs, matching the real-data calibration convention.

This fixes the prior NetLogo behavior in which `attend?` remained true until the next day. Old pilot results therefore do not validate the new model.

## Balanced and reproducible populations

There are 4 x 4 x 4 x 3 = 192 possible profile combinations. With the balanced mix, for example with 100 agents, the allocation is:

- 25 agents per availability group;
- 25 per time preference, with six or seven of each preference inside each availability group;
- 25 per flexibility level;
- 33 or 34 per crowding type.

Assignments are randomized subject to these marginal counts. This does not fully balance all 192 joint combinations. The population seed controls profile assignments and tie priorities, independently of the strategy seed and memory length. Attributes stay fixed throughout a run. Both implementations use the same specified Park-Miller generator for profiles and linear-strategy weights so matching configurations can be checked directly.

Strategy seed is `100000 + population-seed`, so the same population is reused across information and memory conditions. Population and strategy seeds are recorded in the output. Use a new population seed to explore a new assignment; do not change it when comparing conditions for the same replicate.

In the browser, select an agent for its complete profile and allowed starts. Download agent profiles to retain the exact assignments, rules, and tie priorities. In the NetLogo Command Center, `export-agent-profiles "profiles.csv"` exports the current assignment.

## Experiments

`analysis/build_experiments.py` writes `netlogo/experiments.xml` and the copy embedded in the model from one definition; `tests/check_model_config.py` checks that they match. Every experiment pins every model global, runs 50 days (1550 ticks) and discards the first 20, so no seeded history is used in strategy scoring after burn-in, even with memory 10. Calibrated N = 340, C = 37.

| Experiment | Design | Runs |
| --- | --- | --- |
| `info-memory-grid` | info none/live/delayed x memory 1/5/10 x population seeds 1-30 | 270 |
| `info-memory-pilot` | same, seeds 1-5 | 45 |
| `smoke-one-day` | none, memory 5, one day | 1 |
| `legacy-baseline` | grid with `decision-rule = "legacy"`, seeds 1-5 | 45 |
| `calibration-n` | none, memory 1/5/10, N = 330-350 step 5, seeds 1-10 (NetLogo check of the N fit) | 150 |
| `sens-*` (10 experiments) | one setting changed at a time (table above, plus N and C +/-10%, `recency-decay` 0.7, demand-weighted mix) x info x memory 5 x seeds 1-10 | 540 |

Reporters: peak occupancy, % slots over capacity, occupancy variance, good-visit rate, skip rate, lag-1 autocorrelation, and the shifting measures `start-change-rate` (agents visiting on consecutive measured days who change start slot), `mean-start-shift` (slots), `later-than-planned-share` (visits after the agent's first-choice slot that day), `fixed-start-share` (agents with the same start on every measured day), `structural-skip-rate`, `occupancy-profile` (31 slot means) and `profile-rmse` (against the real curve).

**Runtime.** The browser engine takes about 1.6 s per run at N = 340 (one thread). The earlier NetLogo pilot ran about 70 times slower than the browser engine; at that ratio, a run takes about 2 minutes per NetLogo thread. That puts the main grid at about 45 minutes on 12 threads and all 1051 runs at about 3 hours. Replace these estimates with the times recorded in each table's `.meta.json`.

## Running and verifying

From the repository root:

```text
python web/server.py
node --test tests/simulation.test.js
python tests/check_model_config.py
python analysis/calibrate.py --self-test
node tests/diagnose_shifting.js
python analysis/run_pilot.py --smoke
python analysis/run_pilot.py --experiment info-memory-pilot --threads 4
node tests/check_netlogo_parity.js data/processed/preferences_pilot.csv
```

`diagnose_shifting.js` prints the before/after table (legacy vs utility rule) of how often agents change start slot. Recalibration, if the rule or default weights change: `python analysis/calibrate.py`, `node analysis/calibrate_n.js`, `python analysis/calibrate.py` (to record N in the seed file), then `python analysis/build_experiments.py`.

The browser runs at http://127.0.0.1:8000. Every model control is a NetLogo global with the same name and default (checked by a unit test); "Days to simulate" corresponds to the BehaviorSpace time limit. Changing a setting restarts the run with the same seeds. "Run to end" runs the remaining days without animation and fills the results panel (post-burn-in measures and occupancy by time of day against the real curve). "Compare info modes" runs none, live and delayed with the current settings and seeds and shows them side by side. "Reset to calibrated defaults" restores the defaults. Above 300 agents the agent field is drawn as a compact canvas; with 1,000 agents an animated slot takes about 5 ms and "Run to end" about 4 s.

Open `netlogo/GymElFarol.nlogox` with NetLogo 7.0.4. The older `.nlogo` file is retained as a legacy version and does not contain these changes. The runner accepts `--netlogo PATH` or `NETLOGO_HOME` if NetLogo is not in its usual installation directory. It stages the include file and shared CSV files (rules, profile mix, seed history) alongside the model. Results are written as `preferences_<experiment>.csv` (`preferences_pilot.csv` for the pilot), with run metadata in `.meta.json`. The original pilot CSV and `analysis/analyze_pilot.py` belong to the older slot model and do not describe this one.

## Calibration of scale, seed history and population size

**Scale.** Real 3WR+4WR counts are scaled so that the observed 95th percentile (236 people, regular-term Mon-Thu 06:30-22:00) equals the model capacity of 37 agents: scale = 37/236. Capacity is therefore the real p95, and the real share of slots over capacity (4.89%) is about 5% by construction. Matching it means the model's own p95 is close to capacity.

**Seed history** (`analysis/calibrate.py`, written to `netlogo/seed_history.csv`). Each slot's pooled Mon-Thu mean is shrunk toward its nearest observed neighbouring slots, and each weekday mean toward that shrunk slot mean, by observation count: (n x mean + k x prior)/(n + k), k = 5. Every slot gets the same four Mon-Thu values, so no slot is seeded with a single repeated number. 06:30 has no observations and uses its neighbour estimate; it is flagged `filled=True, n_obs=0`. Friday is left out because the gym closes at 20:00. `reference_n` records the population the seed values correspond to. With `scale-seed-with-n?` on (the default), both engines multiply the seeds and the real comparison curve by n-agents / reference_n, so another N keeps the same per-agent demand. `capacity-from-ratio?` with `capacity-ratio` (default 10.88%) does the same for capacity.

**Population size N** (`analysis/calibrate_n.js`, results in `data/processed/calibration_n.json` and `.csv`). The utility rule with default weights is run under information **none** only, memory 1/5/10 and population seeds 1-30, for 50 days with 20 burn-in. A coarse grid covers N = 250-500 in steps of 25, then a step-5 grid covers the bracketing interval. N* is where the mean percentage of slots over capacity crosses the real 4.89%, by linear interpolation: **N* = 340**, with a per-seed 95% range of 330-349. The occupancy-profile RMSE against the real curve is a check, not a target. It is lowest near this N (about 6.3 agents). The pooled 4.9% hides a large memory effect. At N = 340 the share over capacity is 10.4% with memory 1, 2.9% with memory 5 and 1.3% with memory 10. Memory is an experimental factor, so the calibration averages over it rather than matching any single level. Live and delayed runs are never used for calibration. Re-run both scripts if the decision rule or its default weights change.

**Profile mix (option).** `profile-mix = "demand-weighted"` draws availability and preference jointly from `web/profile-mix.csv`. Those shares come from a non-negative least-squares fit of the 16 availability x preference cells to the shape of the real curve, assuming an even choice among each cell's allowed starts, with a ridge penalty toward balanced shares (0.03). Without the penalty, about 93% of agents fall into the all-day group. The fit lowers the relative curve-shape error from 0.36 (balanced) to 0.14. The main experiments stay balanced, because fitting the mix to the same curve used to judge shape would be circular.

## Research limitations to resolve before conclusions

Do not tune capacity, N, or weights to manufacture a desired information effect. Balanced profile proportions and the utility weights are assumptions.

- **Restless agents.** With learning off, below theta most slots have equal utility for most agents, so agents change start slot on about 87% of days. Temperature barely changes this (at N = 400: 83-86% for tau 0.02-0.1; 66% at tau = 0). Outcome learning gives some habit (about 58%) and cuts crowding. Decide whether to switch learning on, or add a habit term, before the final runs; N must then be recalibrated.
- **NetLogo not yet run.** The NetLogo mirror of the new rule has not been run here. Run the smoke and pilot experiments and `check_netlogo_parity.js` before using BehaviorSpace results. Later sensitivity analyses can vary them. The existing Word report and progress summary still contain older model descriptions and should be updated by the group to describe the final implementation and its limitations.
