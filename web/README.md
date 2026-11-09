# Gym El Farol decision stream

This is a dependency-free browser view of the decision rules in
`netlogo/GymElFarol.nlogox`. It makes each slot decision visible as a live
agent field, action feed, occupancy metric, and chart.

The browser implementation preserves the model's key observable behavior:

- 31 half-hour slots from 06:30 to 21:30;
- one workout decision per agent per day;
- per-slot memory and inductive strategies;
- `none`, `live`, and `delayed` information modes; and
- capacity-based crowding.

NetLogo remains the source of truth for experiments and final results. The
browser view is intended for explanation and exploration, not replacement of
BehaviorSpace runs.

## Run it

From the repository root:

```text
python web/server.py
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000), choose an information mode,
and press **Start simulation**. No packages or build step are required.
