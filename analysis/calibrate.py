"""Derive NetLogo parameters and validation targets from the 30-min panel.

Writes `data/params.json` (capacity, N, evening slots, demand curve),
`data/processed/validation_targets.json` (hourly profile, % over capacity,
coefficient of variation, lag-1 autocorrelation), and
`netlogo/seed_history.csv` for the Gym El Farol csv extension.

Capacity fallback is the 95th percentile of observed 3WR+4WR counts: posted
Rec Services capacities are not in the repo yet. Agent count is 100, with
occupancy scaled so that N = 2 x peak in real units.

    python analysis/calibrate.py
    python analysis/calibrate.py --self-test
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import time
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PANEL_PATH = ROOT / "data" / "processed" / "occupancy_30min.csv"
PARAMS_PATH = ROOT / "data" / "params.json"
TARGETS_PATH = ROOT / "data" / "processed" / "validation_targets.json"
DEMAND_CSV_PATH = ROOT / "data" / "processed" / "demand_curve.csv"
SEED_CSV_PATH = ROOT / "netlogo" / "seed_history.csv"
LOG_PATH = ROOT / "data" / "processed" / "calibrate.log"

TZ_NAME = "America/Toronto"
N_AGENTS = 100
SLOT_START = time(16, 0)
SLOT_END = time(22, 0)
SLOT_MINUTES = 30
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")
# Friday closes at 20:00, so the 12-slot evening window is only fully open Mon-Thu.
FULL_WINDOW_DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday")


def setup_logging() -> None:
    TARGETS_PATH.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(LOG_PATH, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )


def slot_labels() -> list[str]:
    labels = []
    minutes = SLOT_START.hour * 60 + SLOT_START.minute
    end = SLOT_END.hour * 60 + SLOT_END.minute
    while minutes < end:
        labels.append(f"{minutes // 60:02d}:{minutes % 60:02d}")
        minutes += SLOT_MINUTES
    return labels


def load_panel(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(
            f"Missing 30-min panel: {path}. Run `python analysis/clean.py` first."
        )
    frame = pd.read_csv(path)
    frame["slot_start_local"] = pd.to_datetime(
        frame["slot_start_local"], utc=True, errors="coerce"
    ).dt.tz_convert(TZ_NAME)
    if "date" in frame.columns:
        frame["date"] = pd.to_datetime(frame["date"]).dt.date
    for column in ("count_3wr", "count_4wr", "count_cm", "count_fitness"):
        if column in frame.columns:
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
    for column in ("is_weekend", "is_reading_week", "is_exam_period", "is_holiday"):
        if column in frame.columns:
            frame[column] = frame[column].astype(str).str.lower().isin(("true", "1", "yes"))
    return frame


def evening_window(frame: pd.DataFrame, weekdays: tuple[str, ...] = WEEKDAYS) -> pd.DataFrame:
    labels = set(slot_labels())
    mask = (
        frame["slot_label"].isin(labels)
        & frame["dow"].isin(weekdays)
        & ~frame["is_weekend"]
        & ~frame["is_holiday"]
    )
    return frame.loc[mask].copy()


def regular_term(frame: pd.DataFrame) -> pd.DataFrame:
    return frame[
        ~frame["is_reading_week"]
        & ~frame["is_exam_period"]
        & frame["term"].isin(["fall", "winter"])
    ].copy()


def calibration_sample(frame: pd.DataFrame) -> pd.DataFrame:
    """Regular-term Mon-Thu evenings used for capacity, N, and seeding."""
    sample = regular_term(evening_window(frame, FULL_WINDOW_DAYS))
    return sample.dropna(subset=["count_fitness"])


def demand_sample(frame: pd.DataFrame) -> pd.DataFrame:
    """Regular-term weekday evenings, including Friday before close."""
    return regular_term(evening_window(frame, WEEKDAYS)).dropna(subset=["count_fitness"])


def scale_occupancy(value: float, peak: float) -> float:
    if peak <= 0:
        return 0.0
    return value * N_AGENTS / (2.0 * peak)


def demand_curve(sample: pd.DataFrame) -> tuple[dict[str, dict[str, float | None]], dict[str, dict[str, int]]]:
    labels = slot_labels()
    grouped = sample.groupby(["dow", "slot_label"], observed=True)["count_fitness"]
    means = grouped.mean().round(2)
    counts = grouped.size()
    curve: dict[str, dict[str, float | None]] = {}
    n_obs: dict[str, dict[str, int]] = {}
    for day in WEEKDAYS:
        curve[day] = {}
        n_obs[day] = {}
        for label in labels:
            if (day, label) in means.index:
                curve[day][label] = float(means.loc[(day, label)])
                n_obs[day][label] = int(counts.loc[(day, label)])
            else:
                curve[day][label] = None
                n_obs[day][label] = 0
    return curve, n_obs


def weekday_mean_curve(sample: pd.DataFrame) -> list[dict[str, Any]]:
    labels = slot_labels()
    means = sample.groupby("slot_label")["count_fitness"].mean()
    counts = sample.groupby("slot_label")["count_fitness"].size()
    rows = []
    for label in labels:
        mean = float(means[label]) if label in means.index else None
        rows.append(
            {
                "slot": label,
                "mean_occupancy": None if mean is None else round(mean, 2),
                "n_obs": int(counts[label]) if label in counts.index else 0,
            }
        )
    return rows


def hourly_profile(sample: pd.DataFrame) -> dict[str, float]:
    hours = sample["slot_label"].str.slice(0, 2) + ":00"
    means = sample.assign(hour=hours).groupby("hour")["count_fitness"].mean()
    return {hour: round(float(means[hour]), 2) for hour in sorted(means.index)}


def _adjacent_pairs(sample: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Pairs of observations that sit on consecutive 30-min slots the same evening."""
    left: list[float] = []
    right: list[float] = []
    ordered = sample.sort_values(["date", "slot_start_local"])
    for _day, group in ordered.groupby("date", sort=False):
        values = group["count_fitness"].to_numpy(dtype=float)
        gaps = group["slot_start_local"].diff().dt.total_seconds().to_numpy()
        for index in range(1, len(values)):
            if pd.notna(gaps[index]) and abs(float(gaps[index]) - SLOT_MINUTES * 60) < 1:
                left.append(float(values[index - 1]))
                right.append(float(values[index]))
    return np.asarray(left, dtype=float), np.asarray(right, dtype=float)


def lag1_autocorr(sample: pd.DataFrame) -> dict[str, float | int | None]:
    """Lag-1 = correlation between consecutive observed 30-min slots."""
    left, right = _adjacent_pairs(sample)
    if len(left) < 3 or float(np.std(left)) == 0 or float(np.std(right)) == 0:
        return {"adjacent_slots": None, "n_pairs": int(len(left))}
    corr = float(np.corrcoef(left, right)[0, 1])
    return {
        "adjacent_slots": None if not np.isfinite(corr) else round(corr, 4),
        "n_pairs": int(len(left)),
    }


def coefficient_of_variation(values: pd.Series) -> float | None:
    mean = float(values.mean())
    if mean == 0:
        return None
    return round(float(values.std(ddof=1) / mean), 4)


def build_params(sample: pd.DataFrame, evening_all: pd.DataFrame) -> dict[str, Any]:
    fitness = sample["count_fitness"]
    peak = float(fitness.max())
    p95 = float(fitness.quantile(0.95))
    p99 = float(fitness.quantile(0.99))
    capacity_scaled = max(1, int(round(scale_occupancy(p95, peak))))
    n_unscaled = max(1, int(round(2 * peak)))
    labels = slot_labels()
    curve, curve_n = demand_curve(evening_all)
    seed = weekday_mean_curve(sample)
    for row in seed:
        raw = row["mean_occupancy"]
        row["mean_occupancy_scaled"] = (
            None if raw is None else round(scale_occupancy(raw, peak), 2)
        )

    scaled_curve: dict[str, dict[str, float | None]] = {}
    for day, slots in curve.items():
        scaled_curve[day] = {
            label: None if value is None else round(scale_occupancy(value, peak), 2)
            for label, value in slots.items()
        }

    return {
        "timezone": TZ_NAME,
        "fitness_areas": ["3WR", "4WR"],
        "cm_included": False,
        "cm_reason": (
            "Fitness centre only = 3WR + 4WR. CM (cardio mezz) is excluded from "
            "capacity, demand, and validation."
        ),
        "capacity_source": "p95_observed_fallback",
        "capacity_note": (
            "Posted 3WR/4WR capacities from Rec Services are not in the repo yet "
            "(email-capacity still pending). Fallback is the 95th percentile of "
            "observed 3WR+4WR counts on regular-term Mon-Thu evenings 16:00-22:00."
        ),
        "window": {
            "start": SLOT_START.strftime("%H:%M"),
            "end": SLOT_END.strftime("%H:%M"),
            "minutes": SLOT_MINUTES,
            "n_slots": len(labels),
            "labels": labels,
            "days": list(FULL_WINDOW_DAYS),
            "exclude": ["weekend", "holiday", "reading_week", "exam_period", "summer"],
        },
        "observed": {
            "n_slots": int(len(sample)),
            "n_days": int(sample["date"].nunique()),
            "date_start": str(sample["date"].min()),
            "date_end": str(sample["date"].max()),
            "mean": round(float(fitness.mean()), 2),
            "median": round(float(fitness.median()), 2),
            "p95": round(p95, 2),
            "p99": round(p99, 2),
            "peak": round(peak, 2),
            "p95_3wr": round(float(sample["count_3wr"].quantile(0.95)), 2),
            "p95_4wr": round(float(sample["count_4wr"].quantile(0.95)), 2),
        },
        "capacity_observed": int(round(p95)),
        "peak_observed": int(round(peak)),
        "n_agents_unscaled": n_unscaled,
        "capacity_unscaled": int(round(p95)),
        "n_agents": N_AGENTS,
        "capacity": capacity_scaled,
        "scale_factor": round(N_AGENTS / (2.0 * peak), 6) if peak else 0,
        "scale_note": (
            "n_agents=100 with occupancy scaled by 100/(2*peak), i.e. the "
            "unscaled population is 2 x peak count. Use capacity_unscaled and "
            "n_agents_unscaled to run in real head-count units."
        ),
        "slots": labels,
        "demand_curve": curve,
        "demand_curve_n_obs": curve_n,
        "demand_curve_scaled": scaled_curve,
        "seed_history": seed,
        "validation_targets": str(TARGETS_PATH.relative_to(ROOT)).replace("\\", "/"),
    }


def build_targets(sample: pd.DataFrame, params: dict[str, Any]) -> dict[str, Any]:
    fitness = sample["count_fitness"]
    capacity_obs = params["capacity_observed"]
    over = fitness > capacity_obs
    slot_profile = {
        row["slot"]: row["mean_occupancy"] for row in params["seed_history"]
    }
    return {
        "scope": (
            "Regular-term Monday-Thursday evenings 16:00-22:00, fitness = 3WR+4WR. "
            "Reading week, exams, holidays, weekends, and summer are excluded."
        ),
        "n_slots": int(len(sample)),
        "n_days": int(sample["date"].nunique()),
        "hourly_mean_profile": hourly_profile(sample),
        "slot_mean_profile": slot_profile,
        "pct_slots_over_capacity": round(float(over.mean() * 100), 2),
        "capacity_used": capacity_obs,
        "capacity_definition": "95th percentile of the same evening window",
        "coefficient_of_variation": coefficient_of_variation(fitness),
        "lag1_autocorr": lag1_autocorr(sample),
        "peak_hour": max(hourly_profile(sample), key=hourly_profile(sample).get),
        "mean_occupancy": round(float(fitness.mean()), 2),
        "std_occupancy": round(float(fitness.std(ddof=1)), 2),
    }


def write_demand_csv(params: dict[str, Any], path: Path) -> None:
    labels = params["slots"]
    rows = []
    for label in labels:
        row = {"slot": label}
        seed = next((item for item in params["seed_history"] if item["slot"] == label), {})
        row["mean_occupancy"] = seed.get("mean_occupancy")
        row["mean_occupancy_scaled"] = seed.get("mean_occupancy_scaled")
        row["n_obs"] = seed.get("n_obs")
        for day in WEEKDAYS:
            row[day.lower()] = params["demand_curve"].get(day, {}).get(label)
            row[f"{day.lower()}_n"] = params["demand_curve_n_obs"].get(day, {}).get(label, 0)
        rows.append(row)
    pd.DataFrame(rows).to_csv(path, index=False)


def write_seed_csv(params: dict[str, Any], path: Path) -> None:
    """Write the NetLogo csv-extension seed file from params.json.

    One row per evening slot. `mean_occupancy_scaled` is the weekday-pooled
    mean; `monday_scaled` ... `friday_scaled` are the demand-curve values the
    model cycles through when filling each slot's memory.
    """
    labels = params["slots"]
    scaled = params.get("demand_curve_scaled", {})
    rows = []
    for index, label in enumerate(labels):
        seed = next((item for item in params["seed_history"] if item["slot"] == label), {})
        row = {
            "slot_index": index,
            "slot_label": label,
            "mean_occupancy": seed.get("mean_occupancy"),
            "mean_occupancy_scaled": seed.get("mean_occupancy_scaled"),
            "n_obs": seed.get("n_obs"),
        }
        for day in WEEKDAYS:
            row[f"{day.lower()}_scaled"] = scaled.get(day, {}).get(label)
        rows.append(row)
    path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(path, index=False)


def export_seed_from_params(params_path: Path = PARAMS_PATH, seed_path: Path = SEED_CSV_PATH) -> dict[str, Any]:
    if not params_path.exists():
        raise FileNotFoundError(f"Missing params.json: {params_path}. Run calibrate first.")
    params = json.loads(params_path.read_text(encoding="utf-8"))
    write_seed_csv(params, seed_path)
    return params


def calibrate(panel_path: Path = PANEL_PATH) -> tuple[dict[str, Any], dict[str, Any]]:
    panel = load_panel(panel_path)
    evening_all = demand_sample(panel)
    sample = calibration_sample(panel)
    if sample.empty:
        raise ValueError("No weekday-evening fitness observations to calibrate from")
    logging.info(
        "Calibration sample: %s slots across %s Mon-Thu evenings",
        len(sample),
        sample["date"].nunique(),
    )
    params = build_params(sample, evening_all)
    targets = build_targets(sample, params)
    PARAMS_PATH.parent.mkdir(parents=True, exist_ok=True)
    PARAMS_PATH.write_text(json.dumps(params, indent=2) + "\n", encoding="utf-8")
    TARGETS_PATH.write_text(json.dumps(targets, indent=2) + "\n", encoding="utf-8")
    write_demand_csv(params, DEMAND_CSV_PATH)
    write_seed_csv(params, SEED_CSV_PATH)
    logging.info("seed_history.csv: %s slots for NetLogo csv extension", len(params["slots"]))
    logging.info(
        "params.json: n_agents=%s capacity=%s (observed p95=%s, peak=%s)",
        params["n_agents"],
        params["capacity"],
        params["capacity_observed"],
        params["peak_observed"],
    )
    logging.info(
        "validation: %% over capacity=%.2f, CV=%s, lag1=%s",
        targets["pct_slots_over_capacity"],
        targets["coefficient_of_variation"],
        targets["lag1_autocorr"]["adjacent_slots"],
    )
    return params, targets


def run_self_test() -> int:
    failed = 0
    labels = slot_labels()
    if len(labels) != 12 or labels[0] != "16:00" or labels[-1] != "21:30":
        failed += 1
        logging.error("slot labels wrong: %s", labels)
    if abs(scale_occupancy(200, 250) - 40.0) > 1e-9:
        failed += 1
        logging.error("scale_occupancy(200, 250) should be 40")
    if abs(scale_occupancy(0, 250)) > 1e-9:
        failed += 1
        logging.error("scale_occupancy of 0 should be 0")
    if coefficient_of_variation(pd.Series([10.0, 10.0, 10.0])) != 0:
        failed += 1
        logging.error("CV of a constant series should be 0")
    probe = pd.DataFrame(
        {
            "date": [pd.Timestamp("2025-09-08").date()] * 4,
            "slot_start_local": pd.to_datetime(
                [
                    "2025-09-08T16:00:00-04:00",
                    "2025-09-08T16:30:00-04:00",
                    "2025-09-08T17:30:00-04:00",
                    "2025-09-08T18:00:00-04:00",
                ],
                utc=True,
            ),
            "count_fitness": [10.0, 20.0, 100.0, 110.0],
        }
    )
    left, right = _adjacent_pairs(probe)
    if list(left) != [10.0, 100.0] or list(right) != [20.0, 110.0]:
        failed += 1
        logging.error("adjacent pairs should skip the 60-min gap: %s %s", left, right)
    probe_params = {
        "slots": ["16:00", "16:30"],
        "seed_history": [
            {"slot": "16:00", "mean_occupancy": 100.0, "mean_occupancy_scaled": 20.0, "n_obs": 2},
            {"slot": "16:30", "mean_occupancy": 110.0, "mean_occupancy_scaled": 22.0, "n_obs": 1},
        ],
        "demand_curve_scaled": {
            "Monday": {"16:00": 21.0, "16:30": 23.0},
            "Tuesday": {"16:00": 19.0, "16:30": None},
            "Wednesday": {"16:00": 18.5, "16:30": 22.5},
            "Thursday": {"16:00": 20.5, "16:30": 21.5},
            "Friday": {"16:00": None, "16:30": None},
        },
    }
    probe_path = TARGETS_PATH.parent / "_seed_history_selftest.csv"
    write_seed_csv(probe_params, probe_path)
    written = pd.read_csv(probe_path)
    probe_path.unlink(missing_ok=True)
    if list(written["slot_label"]) != ["16:00", "16:30"]:
        failed += 1
        logging.error("seed csv slots wrong: %s", list(written["slot_label"]))
    if float(written.loc[0, "mean_occupancy_scaled"]) != 20.0:
        failed += 1
        logging.error("seed csv pooled mean wrong: %s", written.loc[0, "mean_occupancy_scaled"])
    if float(written.loc[0, "monday_scaled"]) != 21.0:
        failed += 1
        logging.error("seed csv monday_scaled wrong: %s", written.loc[0, "monday_scaled"])
    if failed:
        logging.error("%s self-test(s) failed", failed)
        return 1
    logging.info("All self-tests passed")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--panel", type=Path, default=PANEL_PATH, help="Cleaned 30-min panel")
    parser.add_argument(
        "--run-clean",
        action="store_true",
        help="Run analysis/clean.py first if the panel is missing or always refresh it",
    )
    parser.add_argument("--self-test", action="store_true", help="Run unit checks and exit")
    parser.add_argument(
        "--export-seed",
        action="store_true",
        help="Rewrite netlogo/seed_history.csv from the existing params.json and exit",
    )
    return parser


def main() -> int:
    setup_logging()
    args = build_parser().parse_args()
    if args.self_test:
        return run_self_test()
    if args.export_seed:
        export_seed_from_params()
        logging.info("Wrote %s from %s", SEED_CSV_PATH, PARAMS_PATH)
        return 0
    panel = args.panel
    if args.run_clean or not panel.exists():
        from clean import clean as run_clean

        logging.info("Running cleaner before calibration")
        run_clean()
        panel = PANEL_PATH
    calibrate(panel)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
