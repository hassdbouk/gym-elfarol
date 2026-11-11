"""Generate the BehaviorSpace experiments from one definition.

Writes netlogo/experiments.xml and replaces the <experiments> block embedded in
netlogo/GymElFarol.nlogox, so the two copies cannot drift apart.

Every experiment pins every model global, so each output table records the full
configuration and tests/check_netlogo_parity.js can replay any run in the browser.

    python analysis/build_experiments.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / "netlogo" / "GymElFarol.nlogox"
EXTERNAL_PATH = ROOT / "netlogo" / "experiments.xml"
CALIBRATION_PATH = ROOT / "data" / "processed" / "calibration_n.json"

DAYS, BURN_IN, SLOTS = 50, 20, 31
N_CAL = json.loads(CALIBRATION_PATH.read_text(encoding="utf-8"))["chosen_n"]
CAPACITY = 37
CAPACITY_RATIO = json.loads(CALIBRATION_PATH.read_text(encoding="utf-8"))["capacity_ratio_pct"]

METRICS = [
    "peak-occupancy", "pct-slots-over-capacity", "occupancy-variance", "good-visit-rate", "skip-rate",
    "lag1-autocorr", "simulation-seed", "start-change-rate", "mean-start-shift", "later-than-planned-share",
    "fixed-start-share", "structural-skip-rate", "occupancy-profile", "profile-rmse",
]

# Model defaults (must match web/simulation.js DEFAULTS and the NetLogo widget defaults).
BASE: dict[str, object] = {
    "info-mode": ["none", "live", "delayed"],
    "memory-size": [1, 5, 10],
    "number-strategies": 10,
    "n-agents": N_CAL,
    "capacity": CAPACITY,
    "delay": 2,
    "burn-in-days": BURN_IN,
    "must-go?": False,
    "seed-from-data?": True,
    "visualize?": False,
    "workout-slots": 2,
    "decision-rule": "utility",
    "workout-value": 1,
    "crowd-penalty": 1,
    "comfort-threshold": 0.8,
    "time-weight": 0.5,
    "taste-weight": 0.25,
    "choice-temperature": 0.1,
    "outcome-learning?": False,
    "learning-rate": 0.2,
    "learning-weight": 0.5,
    "recency-decay": 1,
    "scale-seed-with-n?": True,
    "capacity-from-ratio?": False,
    "capacity-ratio": CAPACITY_RATIO,
    "profile-mix": "balanced",
}


def seeds(n: int) -> list[int]:
    return list(range(1, n + 1))


def experiment(name: str, overrides: dict[str, object], n_seeds: int, days: int = DAYS) -> dict:
    values = {**BASE, **overrides, "population-seed": seeds(n_seeds)}
    return {"name": name, "values": values, "time_limit": days * SLOTS}


SENSITIVITY = {
    # one parameter at a time around the defaults; info x memory 5 x 10 seeds each
    "crowd-penalty": [0.5, 2],
    "comfort-threshold": [0.6, 0.9],
    "time-weight": [0.25, 1],
    "taste-weight": [0, 0.5],
    "choice-temperature": [0, 0.05, 0.25],
    "n-agents": [round(N_CAL * 0.9), round(N_CAL * 1.1)],
    "capacity": [round(CAPACITY * 0.9), round(CAPACITY * 1.1)],
    "outcome-learning?": [True],
    "recency-decay": [0.7],
    "profile-mix": ["demand-weighted"],
}

EXPERIMENTS = [
    experiment("info-memory-grid", {}, 30),
    experiment("info-memory-pilot", {}, 5),
    experiment("smoke-one-day", {"info-mode": ["none"], "memory-size": [5], "burn-in-days": 0}, 1, days=1),
    experiment("legacy-baseline", {"decision-rule": "legacy"}, 5),
    experiment("calibration-n", {"info-mode": ["none"], "n-agents": [N_CAL - 10, N_CAL - 5, N_CAL, N_CAL + 5, N_CAL + 10]}, 10),
] + [
    experiment(f"sens-{name.rstrip('?')}", {name: values, "memory-size": [5]}, 10) for name, values in SENSITIVITY.items()
]


def literal(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return f"&quot;{value}&quot;"
    return str(value)


def render() -> str:
    lines = ["<experiments>"]
    for exp in EXPERIMENTS:
        lines.append(f'    <experiment name="{exp["name"]}" repetitions="1" sequentialRunOrder="true" runMetricsEveryStep="false" timeLimit="{exp["time_limit"]}">')
        lines.append("      <setup>set simulation-seed 100000 + population-seed setup</setup>")
        lines.append("      <go>go</go>")
        lines.append("      <metrics>")
        lines.extend(f"        <metric>{m}</metric>" for m in METRICS)
        lines.append("      </metrics>")
        lines.append("      <constants>")
        for variable, value in exp["values"].items():
            values = value if isinstance(value, list) else [value]
            inner = "".join(f'<value value="{literal(v)}" />' for v in values)
            lines.append(f'        <enumeratedValueSet variable="{variable}">{inner}</enumeratedValueSet>')
        lines.append("      </constants>")
        lines.append("    </experiment>")
    lines.append("  </experiments>")
    return "\n".join(lines)


def run_count(exp: dict) -> int:
    count = 1
    for value in exp["values"].values():
        count *= len(value) if isinstance(value, list) else 1
    return count


def main() -> None:
    block = render()
    EXTERNAL_PATH.write_text('<?xml version="1.0" encoding="UTF-8"?>\n' + block + "\n", encoding="utf-8")
    model = MODEL_PATH.read_text(encoding="utf-8")
    model, n = re.subn(r"<experiments>.*?</experiments>", lambda _: block, model, flags=re.S)
    assert n == 1, "expected one embedded <experiments> block"
    MODEL_PATH.write_text(model, encoding="utf-8")
    for exp in EXPERIMENTS:
        print(f"{exp['name']:24s} {run_count(exp):4d} runs  {exp['time_limit']} ticks")
    print(f"total {sum(run_count(e) for e in EXPERIMENTS)} runs")


if __name__ == "__main__":
    main()
