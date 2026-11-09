"""Check canonical experiment definitions and shared inputs without NetLogo."""
from pathlib import Path
import csv
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
model = ET.parse(root / "netlogo/GymElFarol.nlogox").getroot()
external = ET.parse(root / "netlogo/experiments.xml").getroot()

def normalized(element):
    return element.tag, sorted(element.attrib.items()), (element.text or "").strip(), [normalized(x) for x in element]

assert normalized(model.find("experiments")) == normalized(external), "Embedded and external experiments disagree"
for experiment in external:
    factors = experiment.findall("constants/enumeratedValueSet")
    runs = int(experiment.get("repetitions"))
    for factor in factors:
        runs *= len(factor)
    expected = {"info-memory-pilot": 45, "info-memory-grid": 270, "smoke-one-day": 1}[experiment.get("name")]
    assert runs == expected
    assert int(experiment.get("timeLimit")) == (31 if expected == 1 else 1240)
    assert experiment.find("constants/enumeratedValueSet[@variable='workout-slots']/value").get("value") == "2"
    assert "simulation-seed" in experiment.find("setup").text
rules = list(csv.DictReader((root / "web/profile-rules.csv").open(encoding="utf-8", newline="")))
assert len(rules) == 15
assert len(list(csv.DictReader((root / "netlogo/seed_history.csv").open(encoding="utf-8", newline="")))) == 31
assert (root / "netlogo/preferences.nls").is_file()
print("Shared rules and experiment configuration checks passed (45 pilot / 270 full runs)")
