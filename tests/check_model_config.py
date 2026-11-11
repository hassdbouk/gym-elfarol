"""Check canonical experiment definitions and shared inputs without NetLogo."""
from pathlib import Path
import csv
import json
import re
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
model = ET.parse(root / "netlogo/GymElFarol.nlogox").getroot()
external = ET.parse(root / "netlogo/experiments.xml").getroot()

def normalized(element):
    return element.tag, sorted(element.attrib.items()), (element.text or "").strip(), [normalized(x) for x in element]

assert normalized(model.find("experiments")) == normalized(external), "Embedded and external experiments disagree (run analysis/build_experiments.py)"

calibrated_n = json.loads((root / "data/processed/calibration_n.json").read_text(encoding="utf-8"))["chosen_n"]
widgets = {w.get("variable") for w in model.find("widgets") if w.get("variable")}
reporters = set(re.findall(r"^to-report ([\w?-]+)", (root / "netlogo/GymElFarol.nlogox").read_text(encoding="utf-8"), re.M))
expected_runs = {
    "info-memory-grid": 270, "info-memory-pilot": 45, "smoke-one-day": 1, "legacy-baseline": 45, "calibration-n": 150,
    "sens-crowd-penalty": 60, "sens-comfort-threshold": 60, "sens-time-weight": 60, "sens-taste-weight": 60,
    "sens-choice-temperature": 90, "sens-n-agents": 60, "sens-capacity": 60, "sens-outcome-learning": 30,
    "sens-recency-decay": 30, "sens-profile-mix": 30,
}
assert {e.get("name") for e in external} == set(expected_runs), "Experiment list changed"
for experiment in external:
    name = experiment.get("name")
    factors = {f.get("variable"): [v.get("value") for v in f] for f in experiment.findall("constants/enumeratedValueSet")}
    runs = int(experiment.get("repetitions"))
    for values in factors.values():
        runs *= len(values)
    assert runs == expected_runs[name], (name, runs)
    assert int(experiment.get("timeLimit")) == (31 if name == "smoke-one-day" else 50 * 31), name
    # Every model global is pinned, so each table carries its full configuration.
    pinned = (widgets | {"population-seed"}) - {"simulation-seed", None}  # simulation-seed is set in <setup>
    assert set(factors) == pinned, (name, pinned ^ set(factors))
    assert factors["workout-slots"] == ["2"] and factors["seed-from-data?"] == ["true"]
    assert factors["burn-in-days"] == (["0"] if name == "smoke-one-day" else ["20"]), name
    assert factors["decision-rule"] == (['"legacy"'] if name == "legacy-baseline" else ['"utility"']), name
    if not name.startswith(("sens-n-agents", "calibration-n")):
        assert factors["n-agents"] == [str(calibrated_n)], name
    assert "simulation-seed" in experiment.find("setup").text
    for metric in experiment.findall("metrics/metric"):
        assert metric.text in reporters or metric.text == "simulation-seed", metric.text
rules = list(csv.DictReader((root / "web/profile-rules.csv").open(encoding="utf-8", newline="")))
assert len(rules) == 15
assert len(list(csv.DictReader((root / "netlogo/seed_history.csv").open(encoding="utf-8", newline="")))) == 31
assert len(list(csv.DictReader((root / "web/profile-mix.csv").open(encoding="utf-8", newline="")))) == 16
assert (root / "netlogo/preferences.nls").is_file()
print(f"Shared rules and experiment configuration checks passed ({len(expected_runs)} experiments, {sum(expected_runs.values())} runs, N = {calibrated_n})")
