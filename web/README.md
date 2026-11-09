# Gym El Farol browser simulation

Run `python web/server.py` from the repository root and open http://127.0.0.1:8000.
Use `python web/server.py --port 8765` if port 8000 is occupied.
No third-party Python or JavaScript packages are needed for the browser.

Choose None, Live, or Delayed information, then use Start simulation or Step. Each tick is 30 minutes. Workouts last one hour and fit inside individual availability windows. Reset replays the same population and strategy seeds; change a seed to explore a different assignment. Changing information or memory restarts with the same population. The run stops at the selected day limit.

Select an agent to inspect their availability, preferred period, flexibility, crowding preference, allowed start times, and current status. The population panel shows group counts. Download agent profiles saves the full assignment and configuration as JSON.

The rule definitions are in `web/profile-rules.csv`, shared with NetLogo. The server exposes the existing `netlogo/seed_history.csv` at `/seed-history.csv`. Open the page through the server so both CSV files load.

See `docs/agent-preferences.md` for the decision rule, confirmed schedules, experimental design, tests, and limitations. `netlogo/GymElFarol.nlogox` is the current NetLogo model; the `.nlogo` file is a legacy version. Browser experiments are exploratory; use BehaviorSpace for the saved research runs. The parity check compares both implementations using actual BehaviorSpace output.

Checks:

```text
node --test tests/simulation.test.js
python tests/check_model_config.py
node tests/check_netlogo_parity.js data/processed/preferences_pilot.csv
```
