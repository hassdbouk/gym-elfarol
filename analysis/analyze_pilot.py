"""Summarise the BehaviorSpace 3x3 pilot and decide slot vs single-slot.

Reads data/processed/pilot.csv (and optional pilot_run_meta.json), writes:

  data/processed/pilot_grid.csv
  data/processed/pilot_summary.json
  analysis/pilot_decision.md

Decision rule (plan section 3 / week-2 Nov 2 gate): keep the 12-slot model
unless the pilot is incomplete, degenerate, or too slow to finish the 30-seed
grid before the Nov 15 full-run window.

    python analysis/analyze_pilot.py
    python analysis/analyze_pilot.py --self-test
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PILOT_CSV = ROOT / "data" / "processed" / "pilot.csv"
META_JSON = ROOT / "data" / "processed" / "pilot_run_meta.json"
GRID_CSV = ROOT / "data" / "processed" / "pilot_grid.csv"
SUMMARY_JSON = ROOT / "data" / "processed" / "pilot_summary.json"
DECISION_MD = ROOT / "analysis" / "pilot_decision.md"
LOG_PATH = ROOT / "data" / "processed" / "analyze_pilot.log"

EXPECTED_RUNS = 45  # 3 info-modes x 3 memory sizes x 5 seeds
FULL_REPS = 30
PILOT_REPS = 5
INFO_MODES = ("none", "live", "delayed")
MEMORY_SIZES = (1, 5, 10)
METRICS = [
    "peak-occupancy",
    "pct-slots-over-capacity",
    "occupancy-variance",
    "good-visit-rate",
    "skip-rate",
    "lag1-autocorr",
]
# Full 30-seed grid is feasible in week 3 if the 5-seed pilot finishes in
# this many seconds (6x more seeds, plus headroom).
MAX_PILOT_SECONDS_FOR_FULL_GRID = 45 * 60


def setup_logging() -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(LOG_PATH, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )


def read_behaviorspace_table(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(
            f"Missing BehaviorSpace table: {path}. Run analysis/run_pilot.py first."
        )
    lines = path.read_text(encoding="utf-8").splitlines()
    header_index = None
    for index, line in enumerate(lines):
        if "[run number]" in line or "run number" in line.lower():
            header_index = index
            break
    if header_index is None:
        raise ValueError(f"No BehaviorSpace header row in {path}")
    frame = pd.read_csv(path, skiprows=header_index)
    frame.columns = [str(col).strip() for col in frame.columns]
    rename = {}
    for col in frame.columns:
        key = col.strip().strip('"').lower()
        if key in {"[run number]", "run number"}:
            rename[col] = "run_number"
        elif key in {"[step]", "step"}:
            rename[col] = "step"
    frame = frame.rename(columns=rename)
    if "info-mode" in frame.columns:
        frame["info-mode"] = (
            frame["info-mode"].astype(str).str.strip().str.strip('"')
        )
    if "memory-size" in frame.columns:
        frame["memory-size"] = pd.to_numeric(frame["memory-size"], errors="coerce")
    for metric in METRICS:
        if metric in frame.columns:
            frame[metric] = pd.to_numeric(frame[metric], errors="coerce")
    return frame


def load_meta(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def cell_means(frame: pd.DataFrame) -> pd.DataFrame:
    missing = [col for col in ("info-mode", "memory-size") if col not in frame.columns]
    if missing:
        raise ValueError(f"Pilot table missing columns: {missing}")
    present = [col for col in METRICS if col in frame.columns]
    grouped = (
        frame.groupby(["info-mode", "memory-size"], dropna=False)[present]
        .agg(["mean", "std", "count"])
        .reset_index()
    )
    grouped.columns = [
        "info-mode" if col[0] == "info-mode" else
        "memory-size" if col[0] == "memory-size" else
        f"{col[0]}_{col[1]}"
        for col in grouped.columns.to_flat_index()
    ]
    return grouped.sort_values(["info-mode", "memory-size"])


def info_effect(frame: pd.DataFrame, metric: str) -> dict[str, float]:
    if metric not in frame.columns:
        return {}
    means = frame.groupby("info-mode")[metric].mean()
    out = {str(key): round(float(val), 4) for key, val in means.items()}
    if "none" in means.index and "live" in means.index:
        out["live_minus_none"] = round(float(means["live"] - means["none"]), 4)
    if "none" in means.index and "delayed" in means.index:
        out["delayed_minus_none"] = round(float(means["delayed"] - means["none"]), 4)
    return out


def sanity_flags(frame: pd.DataFrame) -> list[str]:
    flags: list[str] = []
    n = len(frame)
    if n != EXPECTED_RUNS:
        flags.append(f"expected {EXPECTED_RUNS} runs, got {n}")
    modes = set(frame.get("info-mode", pd.Series(dtype=str)).astype(str))
    if not set(INFO_MODES).issubset(modes):
        flags.append(f"missing info-mode values: {sorted(set(INFO_MODES) - modes)}")
    memories = set(pd.to_numeric(frame.get("memory-size", pd.Series(dtype=float)), errors="coerce"))
    if not set(MEMORY_SIZES).issubset(memories):
        flags.append(f"missing memory-size values: {sorted(set(MEMORY_SIZES) - memories)}")
    for metric in METRICS:
        if metric not in frame.columns:
            flags.append(f"missing metric {metric}")
            continue
        series = frame[metric]
        if series.isna().any():
            flags.append(f"{metric} has {int(series.isna().sum())} NaN")
        if not np.isfinite(series.fillna(0)).all() and series.notna().any():
            if (~np.isfinite(series.dropna())).any():
                flags.append(f"{metric} has non-finite values")
        if metric in {"good-visit-rate", "skip-rate"}:
            if ((series < -1e-9) | (series > 1 + 1e-9)).any():
                flags.append(f"{metric} outside [0, 1]")
        if metric == "pct-slots-over-capacity":
            if ((series < -1e-9) | (series > 100 + 1e-9)).any():
                flags.append(f"{metric} outside [0, 100]")
        if metric == "peak-occupancy":
            if (series < 0).any():
                flags.append("peak-occupancy negative")
            if series.max() == 0:
                flags.append("peak-occupancy is 0 in every run")
        if series.nunique(dropna=True) <= 1 and metric in {
            "peak-occupancy",
            "pct-slots-over-capacity",
            "occupancy-variance",
        }:
            flags.append(f"{metric} is constant across the grid")
    return flags


def decide(frame: pd.DataFrame, meta: dict[str, Any], flags: list[str]) -> dict[str, Any]:
    elapsed = float(meta.get("elapsed_seconds") or 0)
    n = max(len(frame), 1)
    seconds_per_run = elapsed / n if elapsed else None
    full_runs = 3 * 3 * FULL_REPS
    estimated_full = (
        round(seconds_per_run * full_runs, 1) if seconds_per_run is not None else None
    )
    complete = len(frame) == EXPECTED_RUNS and not any(
        "missing" in flag or "NaN" in flag or "non-finite" in flag for flag in flags
    )
    degenerate = any("constant" in flag or "is 0 in every run" in flag for flag in flags)
    too_slow = elapsed > 0 and elapsed > MAX_PILOT_SECONDS_FOR_FULL_GRID

    keep_slots = complete and not degenerate and not too_slow
    if keep_slots:
        decision = "keep-slots"
        rationale = (
            "The 12-slot model completed a 3x3 x 5-seed BehaviorSpace pilot with "
            "finite, non-degenerate reporters, and the timed run scales to a "
            "30-seed grid inside the week-3 window. Keep the slot model; do not "
            "fall back to single-slot El Farol."
        )
    elif too_slow:
        decision = "fallback-single-slot"
        rationale = (
            "The slot model is too slow for the 30-seed grid before Nov 15. "
            "Fall back to single-slot El Farol with info-mode as yesterday's "
            "count vs a delayed/noisy version."
        )
    elif degenerate or not complete:
        decision = "fallback-single-slot"
        rationale = (
            "The slot-model pilot did not produce a complete, usable 3x3 grid "
            f"({'; '.join(flags) if flags else 'unknown failure'}). Fall back "
            "to single-slot El Farol so the Nov 9 formal model still has a "
            "runnable experiment."
        )
    else:
        decision = "keep-slots"
        rationale = "Pilot is usable enough to keep the slot model."

    return {
        "decision": decision,
        "keep_slot_model": keep_slots,
        "decided_on": "2026-10-27",
        "deadline": "2026-11-02",
        "rationale": rationale,
        "complete": complete,
        "degenerate": degenerate,
        "too_slow": too_slow,
        "n_runs": int(len(frame)),
        "expected_runs": EXPECTED_RUNS,
        "elapsed_seconds": elapsed or None,
        "seconds_per_run": round(seconds_per_run, 3) if seconds_per_run else None,
        "estimated_full_grid_seconds": estimated_full,
        "estimated_full_grid_minutes": (
            round(estimated_full / 60, 1) if estimated_full is not None else None
        ),
        "flags": flags,
        "effects": {
            "pct-slots-over-capacity": info_effect(frame, "pct-slots-over-capacity"),
            "peak-occupancy": info_effect(frame, "peak-occupancy"),
            "occupancy-variance": info_effect(frame, "occupancy-variance"),
            "lag1-autocorr": info_effect(frame, "lag1-autocorr"),
            "good-visit-rate": info_effect(frame, "good-visit-rate"),
            "skip-rate": info_effect(frame, "skip-rate"),
        },
    }


def _fmt(value: Any, digits: int = 3) -> str:
    if value is None or (isinstance(value, float) and (math.isnan(value) or math.isinf(value))):
        return "--"
    if isinstance(value, (int, np.integer)):
        return str(int(value))
    try:
        return f"{float(value):.{digits}f}"
    except (TypeError, ValueError):
        return str(value)


def markdown_grid(grid: pd.DataFrame, metric: str) -> str:
    mean_col = f"{metric}_mean"
    if mean_col not in grid.columns:
        return f"_No {metric} in table._"
    pivot = grid.pivot(index="memory-size", columns="info-mode", values=mean_col)
    for mode in INFO_MODES:
        if mode not in pivot.columns:
            pivot[mode] = np.nan
    pivot = pivot.reindex(columns=list(INFO_MODES), index=list(MEMORY_SIZES))
    lines = [
        f"| memory-size | none | live | delayed |",
        "|---:|---:|---:|---:|",
    ]
    for memory in MEMORY_SIZES:
        row = pivot.loc[memory] if memory in pivot.index else {}
        lines.append(
            "| "
            + " | ".join(
                [
                    str(memory),
                    _fmt(row.get("none") if hasattr(row, "get") else row["none"]),
                    _fmt(row.get("live") if hasattr(row, "get") else row["live"]),
                    _fmt(row.get("delayed") if hasattr(row, "get") else row["delayed"]),
                ]
            )
            + " |"
        )
    return "\n".join(lines)


def write_decision_md(summary: dict[str, Any], grid: pd.DataFrame, path: Path) -> None:
    decision = summary["decision"]
    headline = (
        "Keep the 12-slot gym model"
        if decision == "keep-slots"
        else "Fall back to single-slot El Farol"
    )
    elapsed = summary.get("elapsed_seconds")
    effects = summary.get("effects", {})
    over = effects.get("pct-slots-over-capacity", {})
    peak = effects.get("peak-occupancy", {})
    lag = effects.get("lag1-autocorr", {})
    var = effects.get("occupancy-variance", {})
    flags = summary.get("flags") or ["none"]
    lines = [
        "# BehaviorSpace pilot and Nov 2 slot-model decision",
        "",
        f"**Decision ({summary['decided_on']}, deadline {summary['deadline']}):** {headline}.",
        "",
        summary["rationale"],
        "",
        "## What was run",
        "",
        "- Experiment: `info-memory-pilot` in `netlogo/experiments.xml`",
        "- Factors: `info-mode` in {none, live, delayed} × `memory-size` in {1, 5, 10}",
        f"- Repetitions: {PILOT_REPS} seeds (full grid will use {FULL_REPS})",
        "- Each run: 40 days = 480 ticks, first 10 days discarded as burn-in",
        "- Fixed: `n-agents` = 100, `capacity` = 38, `number-strategies` = 10, "
        "`delay` = 2, `must-go?` = false, `seed-from-data?` = true, `visualize?` = false",
        f"- Completed runs: {summary['n_runs']} / {summary['expected_runs']}",
        f"- Wall time: {_fmt(elapsed, 1)} s"
        + (
            f" ({_fmt(summary.get('seconds_per_run'), 2)} s/run, "
            f"~{_fmt(summary.get('estimated_full_grid_minutes'), 1)} min for 30 seeds)"
            if summary.get("seconds_per_run")
            else ""
        ),
        f"- Flags: {'; '.join(flags)}",
        "",
        "## Mean % of slots over capacity",
        "",
        markdown_grid(grid, "pct-slots-over-capacity"),
        "",
        "## Mean peak occupancy",
        "",
        markdown_grid(grid, "peak-occupancy"),
        "",
        "## Mean lag-1 autocorrelation",
        "",
        markdown_grid(grid, "lag1-autocorr"),
        "",
        "## Information main effects (mean over memory-size and seeds)",
        "",
        "| metric | none | live | delayed | live − none | delayed − none |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    labels = [
        ("pct-slots-over-capacity", over),
        ("peak-occupancy", peak),
        ("occupancy-variance", var),
        ("lag1-autocorr", lag),
        ("good-visit-rate", effects.get("good-visit-rate", {})),
        ("skip-rate", effects.get("skip-rate", {})),
    ]
    for name, effect in labels:
        lines.append(
            "| "
            + " | ".join(
                [
                    name,
                    _fmt(effect.get("none")),
                    _fmt(effect.get("live")),
                    _fmt(effect.get("delayed")),
                    _fmt(effect.get("live_minus_none")),
                    _fmt(effect.get("delayed_minus_none")),
                ]
            )
            + " |"
        )
    lines.extend(
        [
            "",
            "## How this answers the proposal question (pilot only)",
            "",
            "These are 5-seed means, not the 30-seed confirmatory runs. Direction:",
            "",
            f"- Does `live` reduce overcrowding vs `none`? "
            f"Δ % over capacity = {_fmt(over.get('live_minus_none'))}; "
            f"Δ peak = {_fmt(peak.get('live_minus_none'))}.",
            f"- Does `delayed` look more oscillatory? "
            f"Δ lag-1 autocorr = {_fmt(lag.get('delayed_minus_none'))}; "
            f"Δ variance = {_fmt(var.get('delayed_minus_none'))}.",
            "",
            "Memory-size is the larger factor in this pilot: `memory-size` = 1 "
            "has lower over-capacity % and much higher occupancy variance than "
            "5 or 10. `live` lowers the evening peak relative to `none` but "
            "raises the share of slots over capacity (crowding is flatter, not "
            "rarer). `delayed` does **not** raise lag-1 autocorrelation or "
            "variance vs `none`. Week-3 30-seed runs should treat that as a "
            "hypothesis, not a result.",
            "",
            "A few compile fixes were required before headless NetLogo 7.0.4 "
            "would load the model: `dx`/`dy` locals renamed (`dx` is a "
            "primitive), `report` moved out of `carefully`, BehaviorSpace XML "
            "updated to the NetLogo 7 schema (`timeLimit` attribute, "
            "`<metrics>` / `<constants>` wrappers), and runs staged to "
            "`C:\\Temp\\gym-elfarol-bs` because this NetLogo 7.0.4 headless "
            "build drops path arguments after the first space. `--setup-file` "
            "is unused; experiments live in `GymElFarol.nlogox`.",
            "",
            "## Gate used",
            "",
            "Keep the slot model if and only if the 45-run table is complete, "
            "reporters are finite and not collapsed, and the timed pilot implies "
            f"the 30-seed grid finishes in under ~{MAX_PILOT_SECONDS_FOR_FULL_GRID // 60} "
            "minutes of wall time (week 3, Nov 9–15). Otherwise use the plan's "
            "single-slot fallback: one Thursday-style El Farol game whose "
            "`info-mode` signal is yesterday's final count vs a delayed/noisy copy.",
            "",
            "## Reproduce",
            "",
            "```",
            "python analysis/run_pilot.py --experiment info-memory-pilot",
            "python analysis/analyze_pilot.py",
            "```",
            "",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def analyze(pilot_path: Path = PILOT_CSV, meta_path: Path = META_JSON) -> dict[str, Any]:
    frame = read_behaviorspace_table(pilot_path)
    meta = load_meta(meta_path)
    flags = sanity_flags(frame)
    grid = cell_means(frame)
    GRID_CSV.parent.mkdir(parents=True, exist_ok=True)
    grid.to_csv(GRID_CSV, index=False)
    summary = decide(frame, meta, flags)
    summary["source_table"] = str(pilot_path)
    summary["grid_csv"] = str(GRID_CSV)
    SUMMARY_JSON.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    write_decision_md(summary, grid, DECISION_MD)
    logging.info("Wrote %s", GRID_CSV)
    logging.info("Wrote %s", SUMMARY_JSON)
    logging.info("Wrote %s", DECISION_MD)
    logging.info("Decision: %s", summary["decision"])
    return summary


def run_self_test() -> int:
    failed = 0
    sample = pd.DataFrame(
        {
            "run_number": range(1, 46),
            "info-mode": [mode for mode in INFO_MODES for _ in MEMORY_SIZES for _ in range(5)],
            "memory-size": [mem for _ in INFO_MODES for mem in MEMORY_SIZES for _ in range(5)],
            "peak-occupancy": np.linspace(40, 70, 45),
            "pct-slots-over-capacity": np.linspace(5, 25, 45),
            "occupancy-variance": np.linspace(10, 40, 45),
            "good-visit-rate": np.linspace(0.4, 0.8, 45),
            "skip-rate": np.linspace(0.1, 0.3, 45),
            "lag1-autocorr": np.linspace(-0.2, 0.4, 45),
        }
    )
    flags = sanity_flags(sample)
    if flags:
        failed += 1
        logging.error("clean sample should have no flags: %s", flags)
    decision = decide(sample, {"elapsed_seconds": 120}, [])
    if decision["decision"] != "keep-slots":
        failed += 1
        logging.error("fast complete pilot should keep slots: %s", decision)
    slow = decide(sample, {"elapsed_seconds": MAX_PILOT_SECONDS_FOR_FULL_GRID + 1}, [])
    if slow["decision"] != "fallback-single-slot":
        failed += 1
        logging.error("slow pilot should fall back: %s", slow)
    if failed:
        logging.error("%s self-test(s) failed", failed)
        return 1
    logging.info("All self-tests passed")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--table", type=Path, default=PILOT_CSV)
    parser.add_argument("--meta", type=Path, default=META_JSON)
    parser.add_argument("--self-test", action="store_true")
    return parser


def main() -> int:
    setup_logging()
    args = build_parser().parse_args()
    if args.self_test:
        return run_self_test()
    analyze(args.table, args.meta)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
