"""Section 5 analysis of the info-memory BehaviorSpace grid.

Reads a BehaviorSpace table (default data/processed/info-memory-grid.csv) and
data/processed/validation_targets.json, then:

  1. paired info-mode contrasts (live - none, delayed - none) per memory size,
     with a 95% t-interval across population seeds;
  2. 3x3 heatmaps (memory-size x info-mode) of mean % over capacity and peak;
  3. validation of the "none" condition against the real data;
  4. mean % over capacity per condition next to the 1.9% random-choice null.

Writes:
  analysis/figures/grid_heatmap_pct_over_capacity.png
  analysis/figures/grid_heatmap_peak_occupancy.png
  analysis/figures/grid_validation_profile.png
  data/processed/grid_summary.csv
  data/processed/grid_results.md

    python analysis/analyze_grid.py
    python analysis/analyze_grid.py --table data/processed/info-memory-pilot.csv --out-dir <folder>
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402
from scipy import stats  # noqa: E402

from analyze_pilot import read_behaviorspace_table  # noqa: E402
from calibrate import slot_labels  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TABLE = ROOT / "data" / "processed" / "info-memory-grid.csv"
DEFAULT_TARGETS = ROOT / "data" / "processed" / "validation_targets.json"
FIGURES_DIR = ROOT / "analysis" / "figures"
PROCESSED_DIR = ROOT / "data" / "processed"

INFO_MODES = ["none", "live", "delayed"]
MEMORY_SIZES = [1, 5, 10]
CONTRASTS = ["live", "delayed"]  # each compared with "none"
PRIMARY = ["pct-slots-over-capacity", "peak-occupancy"]
SUPPORTING = [
    "occupancy-variance",
    "lag1-autocorr",
    "good-visit-rate",
    "skip-rate",
    "day-to-day-change",
]
NUMERIC_COLUMNS = PRIMARY + SUPPORTING + ["mean-occupancy", "population-seed", "memory-size"]
NULL_PCT_OVER_CAPACITY = 1.9  # random-choice null, % of slots over capacity

# Colours (light chart surface): sequential blue ramp for heatmaps,
# categorical blue / orange / aqua for the three memory sizes.
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_SECONDARY = "#52514e"
BLUE_RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]
MEMORY_COLORS = {1: "#2a78d6", 5: "#eb6834", 10: "#1baf7a"}
MEMORY_MARKERS = {1: "o", 5: "s", 10: "^"}


# ---------------------------------------------------------------- loading

def parse_profile(text) -> list[float]:
    """'"[1.2 3.4 ...]"' -> [1.2, 3.4, ...]"""
    cleaned = str(text).strip().strip('"').strip("[]")
    return [float(value) for value in cleaned.split()]


def load_table(path: Path) -> pd.DataFrame:
    frame = read_behaviorspace_table(path)
    for column in NUMERIC_COLUMNS:
        if column in frame.columns:
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
    if "slot-mean-profile" in frame.columns:
        frame["slot-mean-profile"] = frame["slot-mean-profile"].apply(parse_profile)
    return frame


def check_design(frame: pd.DataFrame) -> list[str]:
    warnings = []
    for column in ["info-mode", "memory-size", "population-seed"] + PRIMARY:
        if column not in frame.columns:
            warnings.append(f"missing column {column}")
    if warnings:
        return warnings
    for mode in INFO_MODES:
        for memory in MEMORY_SIZES:
            n = len(frame[(frame["info-mode"] == mode) & (frame["memory-size"] == memory)])
            if n == 0:
                warnings.append(f"no runs for info-mode={mode}, memory-size={memory}")
    if "slot-mean-profile" in frame.columns:
        n_slots = len(slot_labels())
        bad = frame["slot-mean-profile"].apply(len) != n_slots
        if bad.any():
            warnings.append(f"{int(bad.sum())} runs have a slot profile that is not {n_slots} long")
    return warnings


# ---------------------------------------------------------- 1. contrasts

def t_interval(diffs: np.ndarray) -> tuple[float, float, float]:
    """Mean and 95% t-interval (n-1 df). Interval is NaN if n < 2."""
    n = len(diffs)
    mean = float(np.mean(diffs)) if n else math.nan
    if n < 2:
        return mean, math.nan, math.nan
    half = stats.t.ppf(0.975, n - 1) * np.std(diffs, ddof=1) / math.sqrt(n)
    return mean, mean - half, mean + half


def paired_contrasts(frame: pd.DataFrame, metric: str) -> pd.DataFrame:
    """For each memory size: per-seed (mode - none), summarised across seeds."""
    rows = []
    for memory in MEMORY_SIZES:
        subset = frame[frame["memory-size"] == memory]
        wide = subset.pivot_table(
            index="population-seed", columns="info-mode", values=metric, aggfunc="mean"
        )
        for mode in CONTRASTS:
            if "none" in wide.columns and mode in wide.columns:
                diffs = (wide[mode] - wide["none"]).dropna().to_numpy()
            else:
                diffs = np.array([])
            mean, low, high = t_interval(diffs)
            clear = bool(not math.isnan(low) and (low > 0 or high < 0))
            rows.append(
                {
                    "metric": metric,
                    "memory-size": memory,
                    "contrast": f"{mode} - none",
                    "n_seeds": len(diffs),
                    "mean_diff": mean,
                    "ci_low": low,
                    "ci_high": high,
                    "clear": "clear" if clear else "",
                }
            )
    return pd.DataFrame(rows)


def all_contrasts(frame: pd.DataFrame) -> pd.DataFrame:
    tables = [paired_contrasts(frame, m) for m in PRIMARY + SUPPORTING if m in frame.columns]
    return pd.concat(tables, ignore_index=True)


# ------------------------------------------------- 2 + 4. condition means

def condition_means(frame: pd.DataFrame) -> pd.DataFrame:
    """One row per (info-mode, memory-size): run count, metric means, null comparison."""
    metrics = [m for m in PRIMARY + SUPPORTING + ["mean-occupancy"] if m in frame.columns]
    rows = []
    for mode in INFO_MODES:
        for memory in MEMORY_SIZES:
            cell = frame[(frame["info-mode"] == mode) & (frame["memory-size"] == memory)]
            row = {"info-mode": mode, "memory-size": memory, "n_runs": len(cell)}
            for metric in metrics:
                row[metric] = cell[metric].mean() if len(cell) else math.nan
            row["null_pct_over_capacity"] = NULL_PCT_OVER_CAPACITY
            row["pct_over_minus_null"] = row["pct-slots-over-capacity"] - NULL_PCT_OVER_CAPACITY
            rows.append(row)
    return pd.DataFrame(rows)


def grid_of(means: pd.DataFrame, metric: str) -> pd.DataFrame:
    """memory-size rows x info-mode columns."""
    grid = means.pivot(index="memory-size", columns="info-mode", values=metric)
    return grid.reindex(index=MEMORY_SIZES, columns=INFO_MODES)


def plot_heatmap(means: pd.DataFrame, metric: str, title: str, path: Path) -> None:
    grid = grid_of(means, metric)
    values = grid.to_numpy(dtype=float)
    cmap = LinearSegmentedColormap.from_list("blue_ramp", BLUE_RAMP)
    fig, ax = plt.subplots(figsize=(5.2, 4.2), facecolor=SURFACE)
    ax.set_facecolor(SURFACE)
    image = ax.imshow(values, cmap=cmap, aspect="auto")
    low, high = np.nanmin(values), np.nanmax(values)
    middle = (low + high) / 2 if np.isfinite(low) else 0
    for i in range(len(MEMORY_SIZES)):
        for j in range(len(INFO_MODES)):
            value = values[i, j]
            text = "--" if math.isnan(value) else f"{value:.2f}"
            color = "white" if (not math.isnan(value) and value > middle) else INK
            ax.text(j, i, text, ha="center", va="center", color=color, fontsize=11)
    ax.set_xticks(range(len(INFO_MODES)), INFO_MODES)
    ax.set_yticks(range(len(MEMORY_SIZES)), [str(m) for m in MEMORY_SIZES])
    ax.set_xlabel("info-mode", color=INK_SECONDARY)
    ax.set_ylabel("memory-size", color=INK_SECONDARY)
    ax.set_title(title, color=INK, fontsize=11)
    ax.tick_params(colors=INK_SECONDARY, length=0)
    for spine in ax.spines.values():
        spine.set_visible(False)
    colorbar = fig.colorbar(image, ax=ax, shrink=0.85)
    colorbar.outline.set_visible(False)
    colorbar.ax.tick_params(colors=INK_SECONDARY, length=0)
    fig.tight_layout()
    fig.savefig(path, dpi=150, facecolor=SURFACE)
    plt.close(fig)


# ------------------------------------------------------- 3. validation

def normalize(profile) -> np.ndarray:
    values = np.asarray(profile, dtype=float)
    return values / values.mean()


def hourly_means(profile, labels: list[str]) -> pd.Series:
    """Same grouping as calibrate.hourly_profile: label[:2] + ':00', then mean."""
    hours = [label[:2] + ":00" for label in labels]
    return pd.Series(list(profile), index=hours).groupby(level=0).mean()


def busiest_hour(profile, labels: list[str]) -> str:
    return str(hourly_means(profile, labels).idxmax())


def validation(frame: pd.DataFrame, targets: dict) -> pd.DataFrame:
    labels = slot_labels()
    real_profile = [targets["slot_mean_profile"][label] for label in labels]
    real_norm = normalize(real_profile)
    target_peak = targets["peak_hour"]
    target_lag1 = targets["lag1_autocorr"]["adjacent_slots"]
    target_cv = targets["coefficient_of_variation"]

    none_runs = frame[frame["info-mode"] == "none"]
    rows = []
    for memory in MEMORY_SIZES:
        runs = none_runs[none_runs["memory-size"] == memory]
        if runs.empty:
            continue
        profiles = np.vstack(runs["slot-mean-profile"].to_list())
        mean_profile = profiles.mean(axis=0)
        sim_norm = normalize(mean_profile)
        seed_peaks = [busiest_hour(p, labels) for p in profiles]
        cv = np.sqrt(runs["occupancy-variance"]) / runs["mean-occupancy"]
        rows.append(
            {
                "memory-size": memory,
                "n_runs": len(runs),
                "profile_mae_normalized": float(np.mean(np.abs(sim_norm - real_norm))),
                "sim_peak_hour": busiest_hour(mean_profile, labels),
                "real_peak_hour": target_peak,
                "seeds_peaking_at_real_hour": f"{seed_peaks.count(target_peak)}/{len(seed_peaks)}",
                "sim_lag1_mean": runs["lag1-autocorr"].mean(),
                "sim_lag1_sd": runs["lag1-autocorr"].std(ddof=1),
                "real_lag1": target_lag1,
                "sim_cv_mean": cv.mean(),
                "sim_cv_sd": cv.std(ddof=1),
                "real_cv": target_cv,
            }
        )
    return pd.DataFrame(rows)


def plot_profiles(frame: pd.DataFrame, targets: dict, path: Path) -> None:
    labels = slot_labels()
    real_norm = normalize([targets["slot_mean_profile"][label] for label in labels])
    x = np.arange(len(labels))
    fig, ax = plt.subplots(figsize=(9, 4.2), facecolor=SURFACE)
    ax.set_facecolor(SURFACE)
    ax.plot(x, real_norm, color=INK, linewidth=2.5, label="real (Mon-Thu)")
    none_runs = frame[frame["info-mode"] == "none"]
    for memory in MEMORY_SIZES:
        runs = none_runs[none_runs["memory-size"] == memory]
        if runs.empty:
            continue
        mean_profile = np.vstack(runs["slot-mean-profile"].to_list()).mean(axis=0)
        ax.plot(
            x,
            normalize(mean_profile),
            color=MEMORY_COLORS[memory],
            linewidth=2,
            marker=MEMORY_MARKERS[memory],
            markersize=4,
            label=f"simulated, memory-size {memory}",
        )
    ax.axhline(1.0, color=INK_SECONDARY, linewidth=0.6, alpha=0.4)
    ax.set_xticks(x[::2], labels[::2], rotation=45, ha="right")
    ax.set_xlabel("slot start", color=INK_SECONDARY)
    ax.set_ylabel("occupancy / daily mean", color=INK_SECONDARY)
    ax.set_title('Daily profile, real vs simulated ("none" condition)', color=INK, fontsize=11)
    ax.tick_params(colors=INK_SECONDARY)
    ax.grid(axis="y", color=INK_SECONDARY, alpha=0.15, linewidth=0.6)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(INK_SECONDARY)
        ax.spines[side].set_alpha(0.4)
    ax.legend(frameon=False, labelcolor=INK)
    fig.tight_layout()
    fig.savefig(path, dpi=150, facecolor=SURFACE)
    plt.close(fig)


# ------------------------------------------------------------- output

def fmt(value, digits: int = 3) -> str:
    if isinstance(value, str):
        return value
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "--"
    if isinstance(value, (int, np.integer)):
        return str(int(value))
    return f"{float(value):.{digits}f}"


def markdown_table(table: pd.DataFrame, digits: int = 3) -> str:
    header = "| " + " | ".join(str(c) for c in table.columns) + " |"
    rule = "|" + "|".join("---" for _ in table.columns) + "|"
    body = [
        "| " + " | ".join(fmt(v, digits) for v in row) + " |"
        for row in table.itertuples(index=False)
    ]
    return "\n".join([header, rule] + body)


def grid_markdown(means: pd.DataFrame, metric: str) -> str:
    grid = grid_of(means, metric).reset_index()
    return markdown_table(grid)


def null_table(means: pd.DataFrame) -> pd.DataFrame:
    return means[
        ["info-mode", "memory-size", "n_runs", "pct-slots-over-capacity",
         "null_pct_over_capacity", "pct_over_minus_null"]
    ]


def write_markdown(
    path: Path,
    table_path: Path,
    frame: pd.DataFrame,
    warnings: list[str],
    contrasts: pd.DataFrame,
    means: pd.DataFrame,
    checks: pd.DataFrame,
    figures: list[Path],
) -> None:
    n_seeds = frame["population-seed"].nunique()
    lines = [
        "# Info x memory grid: section 5 results",
        "",
        f"- Input table: `{table_path.name}`",
        f"- Runs: {len(frame)}; population seeds: {n_seeds}",
        f"- Design warnings: {'; '.join(warnings) if warnings else 'none'}",
        "",
        "## 1. Information contrasts (paired by population seed)",
        "",
        "Difference = condition minus `none`, same seed and memory size. "
        "95% t-interval across seeds (n-1 df). `clear` = interval does not include 0.",
        "",
    ]
    for metric in contrasts["metric"].unique():
        part = contrasts[contrasts["metric"] == metric].drop(columns="metric")
        role = "primary" if metric in PRIMARY else "supporting"
        lines += [f"### {metric} ({role})", "", markdown_table(part), ""]
    lines += [
        "## 2. Memory x information: cell means",
        "",
        "### Mean pct-slots-over-capacity",
        "",
        grid_markdown(means, "pct-slots-over-capacity"),
        "",
        "### Mean peak-occupancy",
        "",
        grid_markdown(means, "peak-occupancy"),
        "",
        '## 3. Validation ("none" condition only)',
        "",
        "Profile MAE: simulated and real slot profiles each divided by their own mean. "
        "Peak hour: slots grouped by hour as in `calibrate.py`. "
        "CV = sqrt(occupancy-variance) / mean-occupancy per run. "
        "pct-slots-over-capacity is not used (N was calibrated to it).",
        "",
        markdown_table(checks),
        "",
        "## 4. Comparison with the random-choice null",
        "",
        markdown_table(null_table(means)),
        "",
        "## Files",
        "",
        "- Summary table: `data/processed/grid_summary.csv` (one row per condition)",
    ]
    lines += [f"- Figure: `{fig.name}`" for fig in figures]
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def print_section(title: str, table: pd.DataFrame) -> None:
    print(f"\n=== {title} ===")
    print(table.to_string(index=False, float_format=lambda v: f"{v:.3f}"))


# --------------------------------------------------------------- main

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--table", type=Path, default=DEFAULT_TABLE)
    parser.add_argument("--targets", type=Path, default=DEFAULT_TARGETS)
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help="Write all outputs here instead of analysis/figures and data/processed",
    )
    args = parser.parse_args()

    figures_dir = args.out_dir or FIGURES_DIR
    processed_dir = args.out_dir or PROCESSED_DIR
    figures_dir.mkdir(parents=True, exist_ok=True)
    processed_dir.mkdir(parents=True, exist_ok=True)

    frame = load_table(args.table)
    targets = json.loads(args.targets.read_text(encoding="utf-8"))
    warnings = check_design(frame)
    print(f"Read {len(frame)} runs, {frame['population-seed'].nunique()} seeds from {args.table}")
    for warning in warnings:
        print(f"WARNING: {warning}")

    contrasts = all_contrasts(frame)
    means = condition_means(frame)
    checks = validation(frame, targets)

    figures = [
        figures_dir / "grid_heatmap_pct_over_capacity.png",
        figures_dir / "grid_heatmap_peak_occupancy.png",
        figures_dir / "grid_validation_profile.png",
    ]
    plot_heatmap(means, "pct-slots-over-capacity", "Mean % of slots over capacity", figures[0])
    plot_heatmap(means, "peak-occupancy", "Mean peak occupancy", figures[1])
    plot_profiles(frame, targets, figures[2])

    summary_path = processed_dir / "grid_summary.csv"
    results_path = processed_dir / "grid_results.md"
    means.to_csv(summary_path, index=False)
    write_markdown(results_path, args.table, frame, warnings, contrasts, means, checks, figures)

    print_section("1. Information contrasts (mode - none, paired by seed)", contrasts)
    print_section("2. Mean pct-slots-over-capacity (memory x info)", grid_of(means, "pct-slots-over-capacity").reset_index())
    print_section("2. Mean peak-occupancy (memory x info)", grid_of(means, "peak-occupancy").reset_index())
    print_section('3. Validation ("none" only)', checks)
    print_section("4. Mean % over capacity vs random-choice null (1.9%)", null_table(means))
    print("\nWrote:")
    for path in figures + [summary_path, results_path]:
        print(f"  {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
