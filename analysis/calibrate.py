"""Derive NetLogo parameters and validation targets from the 30-min panel.

Writes `data/params.json` (capacity, N, daily slots 06:30-22:00, demand curve),
`data/processed/validation_targets.json` (hourly profile, % over capacity,
coefficient of variation, lag-1 autocorrelation), and
`netlogo/seed_history.csv` for the Gym El Farol csv extension.

Capacity fallback is the 95th percentile of observed 3WR+4WR counts: posted
Rec Services capacities are not in the repo yet. Occupancy is scaled so the
model capacity of 37 equals that p95 (scale = 37 / p95). The population size
N is fitted separately by analysis/calibrate_n.js and read back from
data/processed/calibration_n.json when present.

Seed history: each slot's pooled Mon-Thu mean is shrunk toward its neighbouring
slots, and each weekday mean toward the shrunk pooled mean, by observation count
(prior strength SHRINK_K), so sparse slots lean on their neighbours openly.

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
CALIBRATION_N_PATH = ROOT / "data" / "processed" / "calibration_n.json"
RULES_PATH = ROOT / "web" / "profile-rules.csv"
MIX_PATH = ROOT / "web" / "profile-mix.csv"

TZ_NAME = "America/Toronto"
# Model capacity in agents; real counts are scaled so that the observed p95 maps to it.
CAPACITY_MODEL = 37
# Population used before calibrate_n.js has written calibration_n.json.
N_AGENTS_FALLBACK = 100
# Prior strength (in observations) for shrinking sparse slot and weekday means.
SHRINK_K = 5
# Ridge strength pulling the demand-weighted profile mix toward balanced shares. Without it
# the fit puts ~93% of agents in the all-day group; 0.03 keeps every availability group
# at >= 11% while cutting the curve-shape error by about 60% versus balanced.
MIX_RIDGE = 0.03
SLOT_START = time(6, 30)
SLOT_END = time(22, 0)
SLOT_MINUTES = 30
# A weekday-by-slot demand value needs at least this many observations; otherwise
# it is left null and the model falls back to the pooled slot mean.
MIN_DAY_OBS = 3
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")
# Friday closes at 20:00, so the 31-slot window is only fully open Mon-Thu.
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


def scale_occupancy(value: float, p95: float) -> float:
    """Real head-count -> model agents, anchored so that p95 equals CAPACITY_MODEL."""
    if p95 <= 0:
        return 0.0
    return value * CAPACITY_MODEL / p95


def calibrated_n() -> tuple[int, str]:
    """Population size from calibrate_n.js, or the fallback before calibration."""
    if CALIBRATION_N_PATH.exists():
        data = json.loads(CALIBRATION_N_PATH.read_text(encoding="utf-8"))
        return int(data["chosen_n"]), str(CALIBRATION_N_PATH.relative_to(ROOT)).replace("\\", "/")
    return N_AGENTS_FALLBACK, "fallback (calibrate_n.js not yet run)"


def neighbour_estimate(means: list[float | None], index: int) -> float | None:
    """Mean of the nearest observed slot on each side (both sides when available)."""
    found = []
    for step in (-1, 1):
        j = index + step
        while 0 <= j < len(means):
            if means[j] is not None:
                found.append(means[j])
                break
            j += step
    return float(np.mean(found)) if found else None


def shrink(mean: float | None, n: int, prior: float | None, k: float = SHRINK_K) -> float | None:
    """(n * mean + k * prior) / (n + k); the prior alone when n = 0."""
    if prior is None:
        return mean
    if n <= 0 or mean is None:
        return prior
    return (n * mean + k * prior) / (n + k)


def shrunk_seed(sample: pd.DataFrame) -> list[dict[str, Any]]:
    """Per-slot pooled and Mon-Thu weekday means, shrunk by observation count."""
    labels = slot_labels()
    pooled = sample.groupby("slot_label")["count_fitness"].agg(["mean", "size"])
    by_day = sample.groupby(["dow", "slot_label"])["count_fitness"].agg(["mean", "size"])
    raw = [float(pooled.loc[l, "mean"]) if l in pooled.index else None for l in labels]
    rows = []
    for i, label in enumerate(labels):
        n = int(pooled.loc[label, "size"]) if label in pooled.index else 0
        neighbour = neighbour_estimate(raw, i)
        pooled_shrunk = shrink(raw[i], n, neighbour)
        row = {"slot": label, "n_obs": n, "raw_mean": raw[i], "neighbour_mean": neighbour, "shrunk_mean": pooled_shrunk, "days": {}}
        for day in FULL_WINDOW_DAYS:
            key = (day, label)
            n_day = int(by_day.loc[key, "size"]) if key in by_day.index else 0
            day_mean = float(by_day.loc[key, "mean"]) if key in by_day.index else None
            row["days"][day] = {"n": n_day, "raw": day_mean, "shrunk": shrink(day_mean, n_day, pooled_shrunk)}
        rows.append(row)
    return rows


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
            n = int(counts.loc[(day, label)]) if (day, label) in means.index else 0
            n_obs[day][label] = n
            if n >= MIN_DAY_OBS:
                curve[day][label] = float(means.loc[(day, label)])
            else:
                curve[day][label] = None
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
    return fill_pooled_gaps(rows)


def fill_pooled_gaps(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fill pooled slot means with no observations from neighbouring slots.

    Interior gaps are linearly interpolated; leading/trailing gaps copy the
    nearest measured slot (06:30 copies 07:00). Each row gets a `filled` flag.
    """
    series = pd.Series(
        [np.nan if r["mean_occupancy"] is None else r["mean_occupancy"] for r in rows],
        dtype=float,
    )
    filled = series.interpolate(limit_direction="both")
    for row, value in zip(rows, filled):
        row["filled"] = row["mean_occupancy"] is None and bool(pd.notna(value))
        if row["filled"]:
            row["mean_occupancy"] = round(float(value), 2)
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


def load_profile_rules(path: Path = RULES_PATH) -> dict[str, list[dict[str, Any]]]:
    rules: dict[str, list[dict[str, Any]]] = {}
    for row in pd.read_csv(path).to_dict("records"):
        rules.setdefault(row["kind"], []).append(row)
    for rows in rules.values():
        rows.sort(key=lambda r: r["id"])
    return rules


def allowed_starts(availability: int, preference: int, flexibility: int, rules: dict, duration: int = 2) -> list[int]:
    """Python copy of allowedStarts in web/simulation.js (used only for the mix fit)."""
    pref = rules["preference"][preference]
    avail = rules["availability"][availability]
    flex = rules["flexibility"][flexibility]["value"]
    windows = [(avail["start1"], avail["end1"])] + ([(avail["start2"], avail["end2"])] if avail["start2"] >= 0 else [])
    out = []
    for slot in range(31):
        start = 390 + 30 * slot
        end = start + duration * 30
        if end > 1320 or not any(start >= a and end <= b for a, b in windows):
            continue
        distance = 0 if preference == 3 else max(0, pref["start1"] - start, start - (pref["end1"] - 30))
        if flex < 0 or distance <= flex:
            out.append(slot)
    return out


def cell_occupancy(rules: dict, duration: int = 2) -> np.ndarray:
    """Expected occupancy by slot for one agent of each availability x preference cell,
    averaged over the four flexibility levels, if it starts uniformly among its allowed starts."""
    columns = []
    for availability in range(4):
        for preference in range(4):
            occupancy = np.zeros(31)
            for flexibility in range(4):
                starts = allowed_starts(availability, preference, flexibility, rules, duration)
                for s in starts:
                    occupancy[s:s + duration] += 1.0 / len(starts) / 4
            columns.append(occupancy)
    return np.column_stack(columns)


def fit_profile_mix(curve: list[float], rules: dict, ridge: float = MIX_RIDGE) -> tuple[list[float], dict[str, float]]:
    """Non-negative cell shares (summing to 1) whose expected occupancy follows the real curve shape.

    Least squares on the curve normalised to the per-agent occupancy budget, with the sum-to-one
    constraint added as a heavily weighted row and a ridge penalty toward balanced shares.
    Returns shares and fit diagnostics.
    """
    from scipy.optimize import nnls

    a = cell_occupancy(rules)
    y = np.asarray(curve, dtype=float)
    y = y / y.sum() * a.sum(axis=0).mean()  # same total occupancy per agent as an average cell
    weight = 100.0
    balanced = np.full(a.shape[1], 1 / a.shape[1])
    a_aug = np.vstack([a, weight * np.ones(a.shape[1]), np.sqrt(ridge) * np.eye(a.shape[1])])
    y_aug = np.concatenate([y, [weight], np.sqrt(ridge) * balanced])
    shares, _ = nnls(a_aug, y_aug)
    shares = shares / shares.sum()
    rmse = lambda w: float(np.sqrt(np.mean((a @ w - y) ** 2)) / y.mean())
    return [round(float(s), 6) for s in shares], {"ridge": ridge, "relative_rmse_balanced": round(rmse(balanced), 4), "relative_rmse_fitted": round(rmse(shares), 4)}


def write_profile_mix(shares: list[float], path: Path = MIX_PATH) -> None:
    rows = [{"availability": c // 4, "preference": c % 4, "share": s} for c, s in enumerate(shares)]
    pd.DataFrame(rows).to_csv(path, index=False)


def build_params(sample: pd.DataFrame, evening_all: pd.DataFrame) -> dict[str, Any]:
    fitness = sample["count_fitness"]
    peak = float(fitness.max())
    p95 = float(fitness.quantile(0.95))
    p99 = float(fitness.quantile(0.99))
    capacity_scaled = CAPACITY_MODEL
    scale = CAPACITY_MODEL / p95
    n_agents, n_source = calibrated_n()
    labels = slot_labels()
    curve, curve_n = demand_curve(evening_all)
    seed = weekday_mean_curve(sample)
    shrunk = {row["slot"]: row for row in shrunk_seed(sample)}
    for row in seed:
        raw = row["mean_occupancy"]
        row["mean_occupancy_scaled"] = (
            None if raw is None else round(scale_occupancy(raw, p95), 2)
        )
        s = shrunk[row["slot"]]
        row["mean_occupancy_shrunk"] = round(s["shrunk_mean"], 2)
        row["mean_occupancy_shrunk_scaled"] = round(scale_occupancy(s["shrunk_mean"], p95), 4)
        row["weekday_shrunk_scaled"] = {
            day: round(scale_occupancy(v["shrunk"], p95), 4) for day, v in s["days"].items()
        }
        row["weekday_n_obs"] = {day: v["n"] for day, v in s["days"].items()}

    scaled_curve: dict[str, dict[str, float | None]] = {}
    for day, slots in curve.items():
        scaled_curve[day] = {
            label: None if value is None else round(scale_occupancy(value, p95), 2)
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
            "observed 3WR+4WR counts on regular-term Mon-Thu, 06:30-22:00."
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
        "n_agents_unscaled": int(round(n_agents / scale)),
        "capacity_unscaled": int(round(p95)),
        "n_agents": n_agents,
        "n_agents_source": n_source,
        "capacity": capacity_scaled,
        "scale_factor": round(scale, 6),
        "scale_note": (
            f"Capacity-anchored: occupancy is scaled by {CAPACITY_MODEL}/p95 so the model "
            "capacity equals the observed p95. n_agents is fitted by analysis/calibrate_n.js "
            "(info none) to the real share of slots over capacity."
        ),
        "seed_shrink_k": SHRINK_K,
        "seed_note": (
            "Seed series are Mon-Thu weekday means. Each slot's pooled mean is shrunk toward "
            "its nearest observed neighbours, and each weekday mean toward the shrunk pooled "
            f"mean: (n * mean + k * prior) / (n + k), k = {SHRINK_K}. Slots with n_obs = 0 "
            "use the neighbour estimate alone."
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
            "Regular-term Monday-Thursday 06:30-22:00, fitness = 3WR+4WR. "
            "Reading week, exams, holidays, weekends, and summer are excluded."
        ),
        "n_slots": int(len(sample)),
        "n_days": int(sample["date"].nunique()),
        "hourly_mean_profile": hourly_profile(sample),
        "slot_mean_profile": slot_profile,
        "pct_slots_over_capacity": round(float(over.mean() * 100), 2),
        "capacity_used": capacity_obs,
        "capacity_definition": "95th percentile of the same daily window",
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
        row["filled"] = seed.get("filled", False)
        for day in WEEKDAYS:
            row[day.lower()] = params["demand_curve"].get(day, {}).get(label)
            row[f"{day.lower()}_n"] = params["demand_curve_n_obs"].get(day, {}).get(label, 0)
        rows.append(row)
    pd.DataFrame(rows).to_csv(path, index=False)


def write_seed_csv(params: dict[str, Any], path: Path) -> None:
    """Write the NetLogo csv-extension seed file from params.json.

    One row per slot. `mean_occupancy_scaled` is the shrunk pooled Mon-Thu mean
    (the real curve the model is compared against); `monday_scaled` ...
    `thursday_scaled` are the shrunk weekday values the model cycles through when
    filling each slot's memory. `friday_scaled` is left empty (Friday closes at
    20:00). `reference_n` is the population these values correspond to; the
    model rescales them by n-agents / reference_n when scale-seed-with-n? is on.
    """
    labels = params["slots"]
    rows = []
    for index, label in enumerate(labels):
        seed = next((item for item in params["seed_history"] if item["slot"] == label), {})
        shrunk_days = seed.get("weekday_shrunk_scaled") or {}
        day_n = seed.get("weekday_n_obs") or {}
        row = {
            "slot_index": index,
            "slot_label": label,
            "mean_occupancy": seed.get("mean_occupancy_shrunk", seed.get("mean_occupancy")),
            "mean_occupancy_scaled": seed.get("mean_occupancy_shrunk_scaled", seed.get("mean_occupancy_scaled")),
            "n_obs": seed.get("n_obs"),
            "filled": seed.get("n_obs", 0) == 0,
        }
        for day in WEEKDAYS:
            row[f"{day.lower()}_scaled"] = shrunk_days.get(day)
        for day in WEEKDAYS:
            row[f"n_obs_{day.lower()}"] = day_n.get(day, 0)
        row["shrink_k"] = params.get("seed_shrink_k", SHRINK_K)
        row["reference_n"] = params.get("n_agents") if params.get("n_agents_source", "").endswith(".json") else None
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
    shares, fit = fit_profile_mix([row["mean_occupancy_shrunk"] for row in params["seed_history"]], load_profile_rules())
    params["profile_mix"] = {
        "file": str(MIX_PATH.relative_to(ROOT)).replace("\\", "/"),
        "method": "NNLS fit of availability x preference cell shares to the shrunk real curve shape (uniform start choice within each cell), ridge toward balanced shares",
        "shares": shares,
        **fit,
    }
    write_profile_mix(shares)
    logging.info("profile-mix.csv: relative RMSE balanced=%s fitted=%s", fit["relative_rmse_balanced"], fit["relative_rmse_fitted"])
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
    gap_rows: list[dict[str, Any]] = [
        {"slot": "06:30", "mean_occupancy": None},
        {"slot": "07:00", "mean_occupancy": 10.0},
        {"slot": "07:30", "mean_occupancy": None},
        {"slot": "08:00", "mean_occupancy": 20.0},
    ]
    fill_pooled_gaps(gap_rows)
    if [r["mean_occupancy"] for r in gap_rows] != [10.0, 10.0, 15.0, 20.0] or [
        r["filled"] for r in gap_rows
    ] != [True, False, True, False]:
        failed += 1
        logging.error("gap fill wrong: %s", gap_rows)
    if len(labels) != 31 or labels[0] != "06:30" or labels[-1] != "21:30":
        failed += 1
        logging.error("slot labels wrong: %s", labels)
    if abs(scale_occupancy(236, 236) - CAPACITY_MODEL) > 1e-9:
        failed += 1
        logging.error("scale_occupancy(p95, p95) should equal CAPACITY_MODEL")
    if shrink(10.0, 5, 20.0, k=5) != 15.0 or shrink(None, 0, 20.0) != 20.0 or shrink(10.0, 0, 20.0) != 20.0:
        failed += 1
        logging.error("shrink() wrong")
    if neighbour_estimate([None, 10.0, None, 30.0], 0) != 10.0 or neighbour_estimate([None, 10.0, None, 30.0], 2) != 20.0:
        failed += 1
        logging.error("neighbour_estimate() wrong")
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
            {"slot": "16:00", "mean_occupancy": 100.0, "mean_occupancy_scaled": 20.0, "n_obs": 2,
             "weekday_shrunk_scaled": {"Monday": 21.0, "Tuesday": 19.0}, "weekday_n_obs": {"Monday": 1}},
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
    if float(written.loc[0, "monday_scaled"]) != 21.0 or int(written.loc[0, "n_obs_monday"]) != 1:
        failed += 1
        logging.error("seed csv monday_scaled wrong: %s", written.loc[0, "monday_scaled"])
    rules = load_profile_rules()
    if allowed_starts(0, 2, 2, rules) != [] or allowed_starts(2, 3, 3, rules) != list(range(30)) or allowed_starts(2, 0, 2, rules)[-1] != 10:
        failed += 1
        logging.error("allowed_starts() disagrees with web/simulation.js")
    occupancy = cell_occupancy(rules)
    if occupancy.shape != (31, 16) or abs(occupancy[:, 10].sum() - 2.0) > 1e-9:
        failed += 1
        logging.error("cell_occupancy() wrong: %s", occupancy.sum(axis=0))
    shares, _ = fit_profile_mix(list(occupancy @ np.full(16, 1 / 16)), rules)
    if abs(sum(shares) - 1) > 1e-5 or min(shares) < 0:
        failed += 1
        logging.error("fit_profile_mix() shares invalid: %s", shares)
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
