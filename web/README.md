# Gym El Farol browser simulation

Run `python web/server.py` from the repository root and open http://127.0.0.1:8000.
Use `python web/server.py --port 8765` if port 8000 is occupied.
No third-party Python or JavaScript packages are needed for the browser.

Choose the settings, then use Start simulation or Step to watch it slot by slot, or **Run to end** to finish the run at once. Each tick is 30 minutes. Workouts last one hour and fit inside individual availability windows. The defaults are the calibrated model: 340 agents, capacity 37, the utility decision rule, 50 days with 20 burn-in days.

- **Settings.** Every model control (basic settings, "Decision rule and utility weights", "Population and data") is a NetLogo global with the same name and default. The control list is in `web/controls.js`, and a unit test checks it against `netlogo/GymElFarol.nlogox`. Hover over a control for a short explanation and its NetLogo name. Changing a setting restarts the run with the same seeds; animation speed does not. **Reset to calibrated defaults** restores everything.
- **Results.** After burn-in the results panel shows % slots over capacity, peak, good-visit rate, skip rate (with structural skips separately), how often agents change start slot, and average occupancy by time of day against the real (scaled) curve. Hover over the chart for values, or open the table view.
- **Compare info modes** runs none, live and delayed with the current settings and the same seeds, and shows them side by side.
- **Agents.** Select an agent, or type its number, to inspect its availability, preferred period, flexibility, crowding preference and allowed starts. Above 300 agents the field is drawn as a compact canvas. Download agent profiles saves the full assignment and configuration as JSON.

The shared inputs are `web/profile-rules.csv` (profiles), `web/profile-mix.csv` (optional demand-weighted mix) and `netlogo/seed_history.csv`, which the server exposes at `/seed-history.csv`. Open the page through the server so the CSV files load.

See `docs/agent-preferences.md` for the decision rule and utility formula, calibration, experiments, tests and limitations. Browser runs are exploratory; use BehaviorSpace for the saved research runs. The parity check replays BehaviorSpace runs in the browser engine and compares every reporter.

Checks:

```text
node --test tests/simulation.test.js
python tests/check_model_config.py
node tests/diagnose_shifting.js
node tests/check_netlogo_parity.js data/processed/preferences_pilot.csv
```
