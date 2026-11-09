# Gym Crowding Project — Progress Summary

## Project idea in simple terms

We are adapting the El Farol Bar Problem to study crowding at Western's gym.

Each student agent decides when to visit the gym. If too many agents choose the same time, the gym becomes crowded. We compare what happens when agents have:

- no live crowd information;
- live crowd information; or
- delayed crowd information.

The main question is whether crowd information reduces crowding or simply causes people to move together to a different time.

## Important clarification

The original El Farol model was not trained using data from the 1990s. It is a rule-based simulation.

Our real Western gym data is being used to:

1. calibrate realistic model values;
2. initialize the agents' attendance memory; and
3. compare the simulation with real gym patterns.

## What has been completed

### 1. Real gym data was collected

We collected **1,174 posts** from `@WesternWeightRm`, covering September 1, 2025 to October 27, 2026.

- 321 posts contained attendance counts as text.
- 852 posts used image cards.
- The newer posts therefore required image recognition rather than only text parsing.

A live-data collector was also created for the Western Recreation Centre status page. It can retrieve the newest post and read its image automatically.

### 2. The posts were converted into usable data

The parser first looks for counts in the post text. If the counts are in an image, it uses OCR to read them.

Results:

- **1,171 of 1,174 posts were parsed successfully**;
- only 3 posts were not usable;
- **8,100 occupancy records** were created;

### 3. The data was cleaned and calibrated

For this project, gym occupancy is defined as:

`3rd-floor weight room + 4th-floor weight room`

The cardio mezzanine is stored in the dataset but is not included in the main fitness-centre count.

The main analysis uses:

- Monday to Thursday;
- 4:00 p.m. to 10:00 p.m.;
- twelve 30-minute time slots; and
- regular academic-term days.

Reading weeks, holidays, exams, weekends, and summer periods are excluded.

The cleaned calibration sample contains **324 observations across 81 days**. Average evening occupancy was about **173 people**, and the busiest average hour was **5:00 p.m.**

Because an official capacity has not yet been confirmed, the current fallback capacity is **239 people**, based on the 95th percentile of observed attendance. In NetLogo, this is scaled to **38 spaces for 100 agents**.

### 4. The NetLogo model was extended

The original El Farol model has been changed into a gym model with:

- twelve evening time slots;
- one gym decision per agent per day;
- separate attendance memory for each time slot;
- `none`, `live`, and `delayed` information conditions;
- real data used to initialize attendance history; and
- measurements for crowding, peak attendance, successful visits, skipped visits, variance, and oscillation.

### 5. A pilot experiment was completed

A pilot tested:

- 3 information conditions;
- 3 memory sizes; and
- 5 random repetitions per combination.

All **45 of 45 runs** completed successfully in about 23 seconds. This confirms that the twelve-slot model works and is fast enough for the larger experiment. We do not need to simplify it to a single-slot model.

The early pilot suggests that live information may lower the highest attendance peak while spreading moderate crowding across more time slots. However, these are preliminary results and should not be treated as final until the 30-repetition experiment is run.

## What still needs to be done

1. Confirm the official 3WR and 4WR capacities with Western Recreation Services. If they are unavailable, document the 95th-percentile fallback.
2. Check or restart the live collector so it continues gathering current data.
3. Run the full experiment with 30 repetitions per condition.
4. Compare the full simulation results with the real gym attendance profile.
5. Create the final graphs and statistical summaries.
6. Finish the formal-model report and later the final project report. A formal-report document already exists, but its completion and submission status should be confirmed by the group.

## Summary of Progress

> We collected Western gym attendance posts and built a pipeline that can read both text posts and image cards. It successfully parsed 1,171 posts and produced 8,100 occupancy records. We cleaned the data and used it to calibrate a NetLogo version of the El Farol model with twelve half-hour gym time slots. The model compares no information, live information, and delayed information. A 45-run pilot completed successfully, so the model is ready for the full experiment. Our next steps running the 30-repetition experiment, validating the results against the real data, and completing the reports.

## Main project files

- `scraper/x_scrape.py` — collects historical X posts
- `scraper/parse_posts.py` — extracts attendance counts using text parsing and OCR
- `data/processed/occupancy_long.csv` — parsed occupancy records
- `analysis/clean.py` — cleans and organizes the data
- `analysis/calibrate.py` — creates model parameters and validation targets
- `data/params.json` — calibrated model settings
- `netlogo/GymElFarol.nlogox` — extended NetLogo model
- `netlogo/experiments.xml` — BehaviorSpace experiment definitions
- `analysis/pilot_decision.md` — pilot results and slot-model decision
- `web/` — dependency-free live browser view of agent decisions and occupancy
