"""Clean occupancy rows onto a 30-minute America/Toronto grid.

Loads the historical X parse (`occupancy_long.csv`) and any live poller rows,
keeps fitness-centre counts (3WR + 4WR; CM is recorded but excluded from the
fitness total), drops closed hours / holidays, and writes a regular 30-min
panel with weekday, term-week, and reading-week flags.

    python analysis/clean.py
    python analysis/clean.py --self-test
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
LONG_PATH = ROOT / "data" / "processed" / "occupancy_long.csv"
LIVE_PATH = ROOT / "data" / "raw" / "live_counts.csv"
OUT_PATH = ROOT / "data" / "processed" / "occupancy_30min.csv"
SUMMARY_PATH = ROOT / "data" / "processed" / "clean_summary.json"
LOG_PATH = ROOT / "data" / "processed" / "clean.log"

TORONTO = ZoneInfo("America/Toronto")
TZ_NAME = "America/Toronto"

# Fitness centre = weight rooms only. Cardio mezz is a different room.
FITNESS_AREAS = ("3WR", "4WR")
OPTIONAL_AREAS = ("CM",)
KEEP_AREAS = FITNESS_AREAS + OPTIONAL_AREAS

# Staff counts that are physically implausible (almost always OCR).
# 3WR text tweets already reach ~226; 4WR text tweets reach ~106.
PLAUSIBLE_MAX = {"3WR": 300, "4WR": 180, "CM": 150}

SLOT_MINUTES = 30


def date_range(start: date, end: date) -> list[date]:
    days = []
    cursor = start
    while cursor <= end:
        days.append(cursor)
        cursor += timedelta(days=1)
    return days

# Regular Fall/Winter hours from western Campus Rec schedules page.
# End times are exclusive (a slot starting at close is closed).
HOURS_FALL_WINTER = {
    0: (time(6, 30), time(23, 30)),  # Mon
    1: (time(6, 30), time(23, 30)),
    2: (time(6, 30), time(23, 30)),
    3: (time(6, 30), time(23, 30)),
    4: (time(6, 30), time(20, 0)),  # Fri
    5: (time(9, 0), time(20, 0)),  # Sat
    6: (time(9, 0), time(23, 30)),  # Sun
}
HOURS_READING_WEEK = {
    0: (time(6, 30), time(22, 0)),  # Mon if not a holiday
    1: (time(6, 30), time(22, 0)),
    2: (time(6, 30), time(22, 0)),
    3: (time(6, 30), time(22, 0)),
    4: (time(6, 30), time(20, 0)),
    5: (time(9, 0), time(18, 0)),
    6: (time(9, 0), time(18, 0)),
}
HOURS_EXAM = {
    0: (time(6, 30), time(22, 0)),
    1: (time(6, 30), time(22, 0)),
    2: (time(6, 30), time(22, 0)),
    3: (time(6, 30), time(22, 0)),
    4: (time(6, 30), time(20, 0)),
    5: (time(9, 0), time(20, 0)),
    6: (time(9, 0), time(20, 0)),
}
HOURS_SUMMER = {
    0: (time(6, 30), time(20, 0)),
    1: (time(6, 30), time(20, 0)),
    2: (time(6, 30), time(20, 0)),
    3: (time(6, 30), time(20, 0)),
    4: (time(6, 30), time(20, 0)),
    5: (time(9, 0), time(17, 0)),
    6: (time(9, 0), time(17, 0)),
}

# Western undergraduate sessional dates (Philosophy key-dates pages).
TERMS: list[dict[str, Any]] = [
    {"name": "fall", "start": date(2025, 9, 4), "end": date(2025, 12, 9)},
    {"name": "winter", "start": date(2026, 1, 5), "end": date(2026, 4, 9)},
    {"name": "fall", "start": date(2026, 9, 9), "end": date(2026, 12, 8)},
    {"name": "winter", "start": date(2027, 1, 4), "end": date(2027, 4, 9)},
]
READING_WEEKS = [
    (date(2025, 11, 3), date(2025, 11, 9)),
    (date(2026, 2, 14), date(2026, 2, 22)),
    (date(2026, 10, 10), date(2026, 10, 18)),
    (date(2027, 2, 13), date(2027, 2, 21)),
]
EXAM_PERIODS = [
    (date(2025, 12, 11), date(2025, 12, 22)),
    (date(2026, 4, 12), date(2026, 4, 30)),
    (date(2026, 12, 11), date(2026, 12, 22)),
    (date(2027, 4, 12), date(2027, 4, 30)),
]
# WSRC is closed on Western holidays and published maintenance weeks.
# Labour Day is listed as open on the Campus Rec hours page.
CLOSED_DATES = {
    date(2025, 10, 13),  # Thanksgiving
    date(2025, 12, 25),
    date(2025, 12, 26),
    date(2026, 1, 1),
    date(2026, 2, 16),  # Family Day
    date(2026, 4, 3),  # Good Friday
    *date_range(date(2026, 5, 4), date(2026, 5, 8)),
    date(2026, 5, 18),  # Victoria Day
    date(2026, 7, 1),  # Canada Day
    date(2026, 8, 3),  # Civic Holiday
    date(2026, 9, 7),  # Labour Day (building closed; Rec notes say open some years)
    date(2026, 10, 12),  # Thanksgiving
}
# Christmas / New Year stretch when the building is typically shut.
CLOSED_RANGES = [
    (date(2025, 12, 23), date(2026, 1, 4)),
]


def in_ranges(day: date, ranges: list[tuple[date, date]]) -> bool:
    return any(start <= day <= end for start, end in ranges)


def calendar_flags(day: date) -> dict[str, Any]:
    is_reading = in_ranges(day, READING_WEEKS)
    is_exam = in_ranges(day, EXAM_PERIODS)
    is_closed = day in CLOSED_DATES or in_ranges(day, CLOSED_RANGES)
    term_name = None
    term_week = None
    for term in TERMS:
        if term["start"] <= day <= term["end"]:
            term_name = term["name"]
            term_week = 1 + (day - term["start"]).days // 7
            break
    if term_name is None and (is_exam or is_reading):
        term_name = "fall" if day.month >= 9 or day.month == 1 else "winter"
    if term_name is None and date(day.year, 5, 1) <= day <= date(day.year, 8, 31):
        term_name = "summer"
    if term_name is None:
        term_name = "break"
    season = "summer" if term_name == "summer" else "fall_winter"
    return {
        "term": term_name,
        "term_week": term_week,
        "is_reading_week": is_reading,
        "is_exam_period": is_exam,
        "is_holiday": is_closed,
        "season": season,
    }


def hours_for(day: date) -> tuple[time, time] | None:
    flags = calendar_flags(day)
    if flags["is_holiday"]:
        return None
    if flags["is_reading_week"]:
        table = HOURS_READING_WEEK
    elif flags["is_exam_period"]:
        table = HOURS_EXAM
    elif flags["season"] == "summer":
        table = HOURS_SUMMER
    else:
        table = HOURS_FALL_WINTER
    return table[day.weekday()]


def is_open(slot_start: datetime) -> bool:
    local = slot_start.astimezone(TORONTO)
    window = hours_for(local.date())
    if window is None:
        return False
    open_at, close_at = window
    clock = local.timetz().replace(tzinfo=None)
    return open_at <= clock < close_at


def setup_logging() -> None:
    SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(LOG_PATH, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )


def parse_local(series: pd.Series) -> pd.Series:
    parsed = pd.to_datetime(series, utc=True, errors="coerce")
    return parsed.dt.tz_convert(TZ_NAME)


def load_long(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Missing occupancy table: {path}")
    frame = pd.read_csv(path)
    frame["timestamp_local"] = parse_local(frame["timestamp_local"])
    frame["source"] = frame.get("source", "x:@WesternWeightRm")
    return frame


def load_live(path: Path) -> pd.DataFrame:
    if not path.exists() or path.stat().st_size == 0:
        return pd.DataFrame(
            columns=[
                "timestamp_local",
                "area",
                "count",
                "source",
                "parse_method",
                "post_id",
                "graphic_time_raw",
            ]
        )
    frame = pd.read_csv(path)
    if frame.empty:
        return frame
    frame = frame.rename(columns={"posted_at_local": "timestamp_local"})
    frame["timestamp_local"] = parse_local(frame["timestamp_local"])
    keep = [
        "timestamp_local",
        "area",
        "count",
        "source",
        "parse_method",
        "post_id",
        "graphic_time_raw",
    ]
    for column in keep:
        if column not in frame.columns:
            frame[column] = ""
    return frame[keep]


def filter_areas(frame: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, Any]]:
    before = len(frame)
    frame = frame[frame["area"].isin(KEEP_AREAS)].copy()
    frame["count"] = pd.to_numeric(frame["count"], errors="coerce")
    frame = frame.dropna(subset=["timestamp_local", "area", "count"])
    frame["count"] = frame["count"].astype(int)
    cap = frame["area"].map(PLAUSIBLE_MAX)
    implausible = frame[frame["count"] > cap]
    frame = frame[(frame["count"] >= 0) & (frame["count"] <= cap)]
    stats = {
        "rows_in": before,
        "rows_kept_areas": len(frame) + len(implausible),
        "rows_implausible_dropped": int(len(implausible)),
        "implausible_examples": [
            {
                "timestamp_local": row.timestamp_local.isoformat(),
                "area": row.area,
                "count": int(row.count),
                "parse_method": row.parse_method,
            }
            for row in implausible.head(10).itertuples()
        ],
    }
    return frame, stats


def attach_slots(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    frame["slot_start_local"] = frame["timestamp_local"].dt.floor(f"{SLOT_MINUTES}min")
    frame["minutes_from_slot"] = (
        frame["timestamp_local"] - frame["slot_start_local"]
    ).dt.total_seconds().abs()
    source_rank = frame["source"].astype(str).str.startswith("x:").map({True: 0, False: 1})
    method_rank = frame["parse_method"].astype(str).str.startswith("tweet").map(
        {True: 0, False: 1}
    )
    frame["_source_rank"] = source_rank.fillna(1)
    frame["_method_rank"] = method_rank.fillna(1)
    frame = frame.sort_values(
        ["slot_start_local", "area", "_source_rank", "_method_rank", "minutes_from_slot"]
    )
    frame = frame.drop_duplicates(["slot_start_local", "area"], keep="first")
    return frame.drop(columns=["_source_rank", "_method_rank"])


def pivot_areas(frame: pd.DataFrame) -> pd.DataFrame:
    values = frame.pivot(index="slot_start_local", columns="area", values="count")
    sources = frame.pivot(index="slot_start_local", columns="area", values="source")
    methods = frame.pivot(index="slot_start_local", columns="area", values="parse_method")
    wide = pd.DataFrame({"slot_start_local": values.index})
    for area in KEEP_AREAS:
        wide[f"count_{area.lower()}"] = (
            values[area].to_numpy() if area in values.columns else pd.NA
        )
        wide[f"source_{area.lower()}"] = (
            sources[area].to_numpy() if area in sources.columns else pd.NA
        )
        wide[f"method_{area.lower()}"] = (
            methods[area].to_numpy() if area in methods.columns else pd.NA
        )
    both = wide["count_3wr"].notna() & wide["count_4wr"].notna()
    wide["count_fitness"] = pd.NA
    wide.loc[both, "count_fitness"] = wide.loc[both, "count_3wr"] + wide.loc[both, "count_4wr"]
    return wide.reset_index(drop=True)


def open_slot_index(start_day: date, end_day: date) -> pd.DatetimeIndex:
    slots: list[datetime] = []
    day = start_day
    while day <= end_day:
        window = hours_for(day)
        if window is not None:
            open_at, close_at = window
            cursor = datetime.combine(day, open_at, tzinfo=TORONTO)
            close = datetime.combine(day, close_at, tzinfo=TORONTO)
            while cursor < close:
                slots.append(cursor)
                cursor += timedelta(minutes=SLOT_MINUTES)
        day += timedelta(days=1)
    return pd.DatetimeIndex(slots, name="slot_start_local")


def annotate_grid(grid: pd.DataFrame) -> pd.DataFrame:
    local = grid["slot_start_local"]
    grid = grid.copy()
    grid["date"] = local.dt.date
    grid["slot_label"] = local.dt.strftime("%H:%M")
    grid["dow"] = local.dt.day_name()
    grid["is_weekend"] = local.dt.day_of_week >= 5
    flags = [calendar_flags(day) for day in grid["date"]]
    for key in ("term", "term_week", "is_reading_week", "is_exam_period", "is_holiday", "season"):
        grid[key] = [row[key] for row in flags]
    grid["is_open"] = True
    return grid


def build_panel(wide: pd.DataFrame) -> pd.DataFrame:
    if wide.empty:
        raise ValueError("No fitness-area rows survived cleaning")
    start_day = wide["slot_start_local"].min().date()
    end_day = wide["slot_start_local"].max().date()
    index = open_slot_index(start_day, end_day)
    grid = pd.DataFrame({"slot_start_local": index})
    merged = grid.merge(wide, on="slot_start_local", how="left")
    merged = annotate_grid(merged)
    ordered = [
        "slot_start_local",
        "date",
        "slot_label",
        "dow",
        "is_weekend",
        "term",
        "term_week",
        "is_reading_week",
        "is_exam_period",
        "is_holiday",
        "season",
        "is_open",
        "count_3wr",
        "count_4wr",
        "count_cm",
        "count_fitness",
        "source_3wr",
        "source_4wr",
        "source_cm",
        "method_3wr",
        "method_4wr",
        "method_cm",
    ]
    return merged[ordered]


def write_csv(path: Path, frame: pd.DataFrame) -> None:
    out = frame.copy()
    out["slot_start_local"] = out["slot_start_local"].dt.strftime("%Y-%m-%dT%H:%M:%S%z")
    out["slot_start_local"] = out["slot_start_local"].str.replace(
        r"([+-]\d{2})(\d{2})$", r"\1:\2", regex=True
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(path, index=False)


def summarise(raw_n: int, live_n: int, area_stats: dict[str, Any], panel: pd.DataFrame) -> dict[str, Any]:
    observed = panel["count_fitness"].notna()
    return {
        "timezone": TZ_NAME,
        "fitness_areas": list(FITNESS_AREAS),
        "cm_included_in_fitness": False,
        "cm_reason": (
            "Fitness centre only = 3WR + 4WR (weight rooms). "
            "CM (cardio mezz) is stored on the panel but excluded from count_fitness."
        ),
        "slot_minutes": SLOT_MINUTES,
        "raw_long_rows": raw_n,
        "live_rows": live_n,
        "area_filter": area_stats,
        "n_open_slots": int(len(panel)),
        "n_slots_with_fitness": int(observed.sum()),
        "coverage": round(float(observed.mean()), 4) if len(panel) else 0,
        "date_start": str(panel["date"].min()) if len(panel) else None,
        "date_end": str(panel["date"].max()) if len(panel) else None,
        "n_open_dates": int(panel["date"].nunique()) if len(panel) else 0,
        "weekday_share": round(float((~panel["is_weekend"]).mean()), 4) if len(panel) else 0,
        "reading_week_slots": int(panel["is_reading_week"].sum()) if len(panel) else 0,
        "csv": str(OUT_PATH.relative_to(ROOT)).replace("\\", "/"),
    }


def clean(long_path: Path = LONG_PATH, live_path: Path = LIVE_PATH, out_path: Path = OUT_PATH) -> pd.DataFrame:
    long_df = load_long(long_path)
    live_df = load_live(live_path)
    raw_n = len(long_df)
    live_n = len(live_df)
    logging.info("Loaded %s historical rows and %s live rows", raw_n, live_n)

    combined = pd.concat([long_df, live_df], ignore_index=True)
    combined, area_stats = filter_areas(combined)
    logging.info(
        "Kept %s area rows; dropped %s implausible counts",
        len(combined),
        area_stats["rows_implausible_dropped"],
    )
    slotted = attach_slots(combined)
    wide = pivot_areas(slotted)
    # Observations that fall in closed hours are not placed on the open grid.
    wide = wide[wide["slot_start_local"].map(is_open)]
    panel = build_panel(wide)
    write_csv(out_path, panel)
    summary = summarise(raw_n, live_n, area_stats, panel)
    SUMMARY_PATH.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    logging.info(
        "Wrote %s open 30-min slots (%s with 3WR+4WR) to %s",
        summary["n_open_slots"],
        summary["n_slots_with_fitness"],
        out_path,
    )
    return panel


def run_self_test() -> int:
    failed = 0

    def check(name: str, got: Any, expected: Any) -> None:
        nonlocal failed
        if got != expected:
            failed += 1
            logging.error("self-test %s: expected %r got %r", name, expected, got)

    slot = pd.Timestamp("2025-09-08T16:07:06-04:00").tz_convert(TZ_NAME)
    check("floor 16:07", slot.floor("30min").strftime("%H:%M"), "16:00")
    slot = pd.Timestamp("2025-09-08T16:33:35-04:00").tz_convert(TZ_NAME)
    check("floor 16:33", slot.floor("30min").strftime("%H:%M"), "16:30")

    monday_eve = datetime(2025, 9, 8, 16, 0, tzinfo=TORONTO)
    friday_late = datetime(2025, 9, 12, 20, 0, tzinfo=TORONTO)
    saturday_early = datetime(2025, 9, 13, 8, 30, tzinfo=TORONTO)
    check("monday 16:00 open", is_open(monday_eve), True)
    check("friday 20:00 closed", is_open(friday_late), False)
    check("saturday 08:30 closed", is_open(saturday_early), False)

    flags = calendar_flags(date(2025, 11, 5))
    check("reading week Nov 2025", flags["is_reading_week"], True)
    check("fall term week present", flags["term"], "fall")
    check("thanksgiving closed", hours_for(date(2025, 10, 13)), None)
    check("family day closed", hours_for(date(2026, 2, 16)), None)

    summer_eve = datetime(2026, 6, 10, 20, 0, tzinfo=TORONTO)
    check("summer weekday 20:00 closed", is_open(summer_eve), False)
    exam_late = datetime(2025, 12, 15, 22, 0, tzinfo=TORONTO)
    check("exam Mon 22:00 closed", is_open(exam_late), False)

    if failed:
        logging.error("%s self-test(s) failed", failed)
        return 1
    logging.info("All self-tests passed")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--long", type=Path, default=LONG_PATH, help="Historical occupancy_long.csv")
    parser.add_argument("--live", type=Path, default=LIVE_PATH, help="Optional live_counts.csv")
    parser.add_argument("--out", type=Path, default=OUT_PATH, help="Output 30-min panel CSV")
    parser.add_argument("--self-test", action="store_true", help="Run calendar/slot checks and exit")
    return parser


def main() -> int:
    setup_logging()
    args = build_parser().parse_args()
    if args.self_test:
        return run_self_test()
    clean(args.long, args.live, args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
