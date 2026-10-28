"""Parse @WesternWeightRm posts into a long occupancy CSV.

Caption regex runs first. Image cards (no 3WR/4WR/CM in the tweet text) are
OCRed with Tesseract (digit+label whitelist, inverted purple graphics). If
Tesseract is missing or does not recover the weight-room counts, RapidOCR is
the fallback — the same engine the live poller already uses.

    python scraper/parse_posts.py
    python scraper/parse_posts.py --self-test
    python scraper/parse_posts.py --spot-check 30
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import random
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
JSONL_PATH = ROOT / "data" / "raw" / "x" / "westernweightrm_posts.jsonl"
MEDIA_DIR = ROOT / "data" / "raw" / "x" / "media"
OCR_CACHE_PATH = ROOT / "data" / "raw" / "x" / "ocr_cache.jsonl"
PROCESSED_DIR = ROOT / "data" / "processed"
CSV_PATH = PROCESSED_DIR / "occupancy_long.csv"
UNPARSED_PATH = PROCESSED_DIR / "unparsed_posts.jsonl"
SUMMARY_PATH = PROCESSED_DIR / "parse_summary.json"
SPOTCHECK_PATH = PROCESSED_DIR / "ocr_spotcheck.csv"
LOG_PATH = PROCESSED_DIR / "parse_posts.log"

SOURCE = "x:@WesternWeightRm"

CSV_FIELDS = [
    "timestamp_local",
    "area",
    "count",
    "source",
    "parse_method",
    "post_id",
    "graphic_time_raw",
]

SPOTCHECK_FIELDS = [
    "post_id",
    "timestamp_local",
    "image_path",
    "parse_method",
    "counts_json",
    "ocr_preview",
    "graphic_time_raw",
]

# Caption formats: "3WR: 36", "3WR 75", "3WR48", "WR3 114", "W.O 15".
# Standalone WR is last and must not eat 3WR / WR3 / Western.
TEXT_PATTERNS: list[tuple[str, str]] = [
    (r"3WR\s*[:=]?\s*(\d+)", "3WR"),
    (r"4WR\s*[:=]?\s*(\d+)", "4WR"),
    (r"WR3\s*[:=]?\s*(\d+)", "3WR"),
    (r"WR4\s*[:=]?\s*(\d+)", "4WR"),
    (r"(?<![A-Za-z0-9])CM\s*[:=]?\s*(\d+)", "CM"),
    (r"(?<![A-Za-z0-9])SPIN\s*[:=]?\s*(\d+)", "SPIN"),
    (r"(?<![A-Za-z0-9])W\.?O\s*[:=]?\s*(\d+)", "WO"),
    # Negative lookahead keeps WR3 from becoming WR=3 and "Western" from matching.
    (r"(?<![A-Za-z0-9])WR(?![A-Za-z0-9])\s*[:=]?\s*(\d+)", "WR"),
]

# Occupancy-card wording after Tesseract / RapidOCR. Number must be the count
# (not "Reopens Wed 7:15 AM"), so the pattern requires digits right after :/=.
GRAPHIC_PATTERNS: list[tuple[str, str]] = [
    # Tesseract often drops the superscript and reads "4th" as "Ath" or "4'".
    (r"3(?:\s*rd)?['’]?\s*floor\s*fitness(?:\s*centre)?\s*[:=]?\s*(\d+)", "3WR"),
    (r"(?:4(?:\s*th)?|ath)['’]?\s*floor\s*fitness(?:\s*centre)?\s*[:=]?\s*(\d+)", "4WR"),
    (r"cardio\s*mezz?\s*[:=]?\s*(\d+)", "CM"),
    (r"women'?s\s*only\s*(?:studio)?\s*[:=]?\s*(\d+)", "WO"),
    # (?![A-Za-z]) stops "Futsal:" + next line "3rd floor" becoming FUTSAL=3.
    (r"(?<![A-Za-z0-9])spin\s*[:=]\s*(\d+)(?![A-Za-z])", "SPIN"),
    (r"(?<![A-Za-z0-9])squash\s*[:=]\s*(\d+)(?![A-Za-z])", "SQUASH"),
    (r"basketball\s*[:=]\s*(\d+)(?![A-Za-z])", "BASKETBALL"),
    (r"volleyball\s*[:=]\s*(\d+)(?![A-Za-z])", "VOLLEYBALL"),
    (r"badminton\s*[:=]\s*(\d+)(?![A-Za-z])", "BADMINTON"),
    (r"pickleball\s*[:=]\s*(\d+)(?![A-Za-z])", "PICKLEBALL"),
    (r"futsal\s*[:=]\s*(\d+)(?![A-Za-z])", "FUTSAL"),
    (r"shallow\s*tank\s*[:=]\s*(\d+)(?![A-Za-z])", "POOL"),
    (r"(?<![A-Za-z0-9])pool\s*[:=]\s*(\d+)(?![A-Za-z])", "POOL"),
]

# RapidOCR often drops spaces ("3rdfloorFitnessCentre:80").
OCR_PREFIXES: list[tuple[str, str]] = [
    ("3rdfloorfitnesscentre", "3WR"),
    ("3floorfitnesscentre", "3WR"),
    ("3rdfloorfitness", "3WR"),
    ("3floorfitness", "3WR"),
    ("4thfloorfitnesscentre", "4WR"),
    ("4floorfitnesscentre", "4WR"),
    ("athfloorfitnesscentre", "4WR"),
    ("4thfloorfitness", "4WR"),
    ("athfloorfitness", "4WR"),
    ("cardiomezz", "CM"),
    ("cardiomez", "CM"),
    ("womensonlystudio", "WO"),
    ("womensonly", "WO"),
    ("pickleball", "PICKLEBALL"),
    ("basketball", "BASKETBALL"),
    ("volleyball", "VOLLEYBALL"),
    ("badminton", "BADMINTON"),
    ("squash", "SQUASH"),
    ("futsal", "FUTSAL"),
    ("shallowtank", "POOL"),
    ("spin", "SPIN"),
]

# Letters stay in the whitelist so area names survive; digits are required for
# the counts. Restricting to this set stops Tesseract from inventing junk glyphs.
TESSERACT_WHITELIST = (
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz:' "
)
TESSERACT_CONFIG = (
    f"--oem 3 --psm 6 -c tessedit_char_whitelist={TESSERACT_WHITELIST}"
)

TESSERACT_CANDIDATE_BINS = [
    Path.home() / "AppData" / "Local" / "Tesseract-OCR" / "tesseract.exe",
    Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
    Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
]

SELF_TESTS: list[tuple[str, dict[str, int]]] = [
    ("3WR: 36\n4WR: 9\nCM: 13\nSPIN: 13\nWO: 3", {"3WR": 36, "4WR": 9, "CM": 13, "SPIN": 13, "WO": 3}),
    ("3WR 75\n4WR 55\nCM 12\nSpin 13\nWO 2", {"3WR": 75, "4WR": 55, "CM": 12, "SPIN": 13, "WO": 2}),
    ("3WR48\n4WR11\nCM13\nSPIN11\nWO1", {"3WR": 48, "4WR": 11, "CM": 13, "SPIN": 11, "WO": 1}),
    ("WR3 114\nWR4 32\nCM 34\nSPIN 11\nWO 6", {"3WR": 114, "4WR": 32, "CM": 34, "SPIN": 11, "WO": 6}),
    ("3WR 100\nCM 33\nSPIN 12\n4WR 56\nW.O 15", {"3WR": 100, "CM": 33, "SPIN": 12, "4WR": 56, "WO": 15}),
    ("3WR: 41 🍂\nCM: 24 🧸\n4WR: 32 🤎\nSPIN: 26 ☕️\nWO: 7B🐿️", {"3WR": 41, "CM": 24, "4WR": 32, "SPIN": 26, "WO": 7}),
    ("3WR 144 4️⃣\n4WR 58 1️⃣\nCM 50 4️⃣", {"3WR": 144, "4WR": 58, "CM": 50}),
    ("WR 44 & CM 8", {"WR": 44, "CM": 8}),
    ("The WRSC will be reopening  on Saturday at 9:00am", {}),
    ("We’ve moved!", {}),
]


def setup_logging() -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(LOG_PATH, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )


def compact_alnum(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def parse_text_counts(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    if not text:
        return counts
    for pattern, area in TEXT_PATTERNS:
        if area in counts:
            continue
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            counts[area] = int(match.group(1))
    return counts


def parse_ocr_counts(text: str, lines: Iterable[str]) -> tuple[dict[str, int], str | None]:
    line_list = [str(line) for line in lines]
    blob = re.sub(r"\s+", " ", " ".join(line_list) if not text else text)
    counts = parse_text_counts(blob)
    for pattern, area in GRAPHIC_PATTERNS:
        if area in counts:
            continue
        match = re.search(pattern, blob, flags=re.IGNORECASE)
        if match:
            counts[area] = int(match.group(1))

    prefixes = sorted(OCR_PREFIXES, key=lambda item: len(item[0]), reverse=True)
    for line in line_list:
        compact = compact_alnum(line)
        for prefix, area in prefixes:
            if area in counts or not compact.startswith(prefix):
                continue
            rest = compact[len(prefix) :]
            match = re.fullmatch(r"(\d+)", rest)
            if match:
                counts[area] = int(match.group(1))
            break

    graphic_time: str | None = None
    for line in line_list:
        compact = compact_alnum(line)
        if "userstats" in compact or re.search(
            r"(january|february|march|april|may|june|july|august|september|october|november|december).*(am|pm)",
            compact,
        ):
            graphic_time = re.sub(r"\s+", " ", line).strip()
            break
    if graphic_time is None:
        match = re.search(
            r"user\s*stats\s+(.+?)(?=\s+(?:squash|basketball|volleyball|3(?:rd)?\s*floor)|$)",
            blob,
            flags=re.IGNORECASE,
        )
        if match:
            graphic_time = match.group(1).strip()
    return counts, graphic_time


def has_weight_room_counts(counts: dict[str, int]) -> bool:
    return "3WR" in counts or "4WR" in counts or "WR" in counts


def resolve_media_path(raw: str) -> Path:
    cleaned = raw.replace("\\", "/")
    path = Path(cleaned)
    if path.is_absolute() and path.exists():
        return path
    return ROOT / cleaned


def media_paths(record: dict[str, Any]) -> list[Path]:
    paths: list[Path] = []
    for raw in record.get("media_files") or []:
        path = resolve_media_path(str(raw))
        if path.exists() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
            paths.append(path)
    if paths:
        return paths
    tweet_id = str(record.get("id") or "")
    if tweet_id:
        for path in sorted(MEDIA_DIR.glob(f"{tweet_id}_*.jpg")):
            paths.append(path)
    return paths


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                logging.warning("Skipping malformed JSONL line")
                continue
            tweet_id = str(record.get("id") or "")
            if not tweet_id:
                continue
            previous = by_id.get(tweet_id)
            if previous is None or (
                record.get("media_files") and not previous.get("media_files")
            ):
                by_id[tweet_id] = record
    records = list(by_id.values())
    records.sort(key=lambda item: item.get("created_at_local") or "")
    return records


def load_ocr_cache(path: Path) -> dict[str, dict[str, Any]]:
    cache: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return cache
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            key = row.get("key")
            if key:
                cache[str(key)] = row
    return cache


def append_ocr_cache(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def find_tesseract_bin() -> Path | None:
    from shutil import which

    found = which("tesseract")
    if found:
        return Path(found)
    for candidate in TESSERACT_CANDIDATE_BINS:
        if candidate.exists():
            return candidate
    return None


def preprocess_for_tesseract(image_path: Path):
    from PIL import Image, ImageEnhance, ImageOps

    image = Image.open(image_path).convert("RGB")
    image = image.resize((image.width * 2, image.height * 2), Image.Resampling.LANCZOS)
    gray = ImageOps.grayscale(image)
    inverted = ImageOps.invert(gray)
    boosted = ImageEnhance.Contrast(inverted).enhance(2.0)
    return boosted.point(lambda pixel: 255 if pixel > 140 else 0)


class OcrBackends:
    def __init__(self) -> None:
        self.tesseract_bin = find_tesseract_bin()
        self._rapidocr = None
        self._pytesseract = None
        if self.tesseract_bin is not None:
            try:
                import os

                import pytesseract

                tessdata = self.tesseract_bin.parent / "tessdata"
                if tessdata.is_dir():
                    os.environ["TESSDATA_PREFIX"] = str(tessdata)
                pytesseract.pytesseract.tesseract_cmd = str(self.tesseract_bin)
                self._pytesseract = pytesseract
                logging.info("Tesseract at %s", self.tesseract_bin)
            except ImportError:
                logging.warning("pytesseract is not installed; pip install -r scraper/requirements.txt")
                self.tesseract_bin = None
        else:
            logging.warning(
                "Tesseract binary not found. Image posts will use RapidOCR until "
                "Tesseract-OCR is installed (winget install UB-Mannheim.TesseractOCR)."
            )

    def tesseract_available(self) -> bool:
        return self._pytesseract is not None

    def rapidocr_lines(self, image_path: Path) -> list[str]:
        if self._rapidocr is None:
            from rapidocr_onnxruntime import RapidOCR

            self._rapidocr = RapidOCR()
        result, _elapse = self._rapidocr(str(image_path))
        if not result:
            return []
        lines: list[str] = []
        for row in result:
            if isinstance(row, (list, tuple)) and len(row) >= 2:
                lines.append(str(row[1]))
        return lines

    def tesseract_lines(self, image_path: Path) -> list[str]:
        if self._pytesseract is None:
            return []
        try:
            prepared = preprocess_for_tesseract(image_path)
            text = self._pytesseract.image_to_string(prepared, config=TESSERACT_CONFIG)
        except Exception as exc:  # missing tessdata, bad image, etc.
            logging.warning("Tesseract failed on %s: %s", image_path.name, exc)
            return []
        return [line.strip() for line in text.splitlines() if line.strip()]


def cache_key(engine: str, image_path: Path) -> str:
    try:
        rel = image_path.resolve().relative_to(ROOT)
    except ValueError:
        rel = image_path
    return f"{engine}:{rel.as_posix()}"


def ocr_image(
    image_path: Path,
    backends: OcrBackends,
    cache: dict[str, dict[str, Any]],
    engine: str,
) -> tuple[list[str], str]:
    """Return (lines, engine_used). engine is tesseract | rapidocr | auto."""
    requested = engine
    order: list[str]
    if requested == "tesseract":
        order = ["tesseract"]
    elif requested == "rapidocr":
        order = ["rapidocr"]
    else:
        order = ["tesseract", "rapidocr"] if backends.tesseract_available() else ["rapidocr"]

    last_lines: list[str] = []
    last_engine = order[-1]
    for name in order:
        if name == "tesseract" and not backends.tesseract_available():
            continue
        key = cache_key(name, image_path)
        if key in cache:
            lines = list(cache[key].get("lines") or [])
        else:
            if name == "tesseract":
                lines = backends.tesseract_lines(image_path)
            else:
                lines = backends.rapidocr_lines(image_path)
            row = {"key": key, "engine": name, "path": str(image_path), "lines": lines}
            cache[key] = row
            append_ocr_cache(OCR_CACHE_PATH, row)
        last_lines = lines
        last_engine = name
        counts, _graphic = parse_ocr_counts(" ".join(lines), lines)
        if has_weight_room_counts(counts) or requested != "auto":
            return lines, name
    return last_lines, last_engine


def parse_record(
    record: dict[str, Any],
    backends: OcrBackends | None,
    cache: dict[str, dict[str, Any]],
    engine: str,
) -> tuple[dict[str, int], str, str | None, Path | None]:
    text = (record.get("full_text") or record.get("text") or "").strip()
    counts = parse_text_counts(text)
    if has_weight_room_counts(counts) or ("CM" in counts and not media_paths(record)):
        return counts, "tweet_text", None, None

    paths = media_paths(record)
    if not paths or backends is None:
        return counts, "unparsed", None, None

    image_path = paths[0]
    lines, used = ocr_image(image_path, backends, cache, engine)
    ocr_counts, graphic_time = parse_ocr_counts(" ".join(lines), lines)
    method = f"ocr_{used}"
    if ocr_counts:
        return ocr_counts, method, graphic_time, image_path
    return {}, "unparsed", graphic_time, image_path


def rows_for_record(
    record: dict[str, Any],
    counts: dict[str, int],
    parse_method: str,
    graphic_time: str | None,
) -> list[dict[str, Any]]:
    timestamp = record.get("created_at_local") or ""
    post_id = str(record.get("id") or "")
    return [
        {
            "timestamp_local": timestamp,
            "area": area,
            "count": count,
            "source": SOURCE,
            "parse_method": parse_method,
            "post_id": post_id,
            "graphic_time_raw": graphic_time or "",
        }
        for area, count in counts.items()
    ]


def write_csv(path: Path, rows: list[dict[str, Any]], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fields})


def run_self_test() -> int:
    failed = 0
    for text, expected in SELF_TESTS:
        got = parse_text_counts(text)
        if got != expected:
            failed += 1
            logging.error("self-test failed for %r\n  expected %s\n  got      %s", text, expected, got)
    graphic_lines = [
        "Western Student Recreation Centre",
        "User Stats October 27th at 7:00 PM",
        "Squash: 8",
        "Basketball: Reopens Wed 7:15 AM",
        "3rd floor Fitness Centre: 88",
        "4th floor Fitness Centre: 41",
        "Cardio Mezz: 33",
        "Spin: 3",
        "Women's Only Studio: 0",
    ]
    graphic_counts, graphic_time = parse_ocr_counts(" ".join(graphic_lines), graphic_lines)
    expected_graphic = {"SQUASH": 8, "3WR": 88, "4WR": 41, "CM": 33, "SPIN": 3, "WO": 0}
    if graphic_counts != expected_graphic:
        failed += 1
        logging.error("graphic self-test failed: %s (time=%s)", graphic_counts, graphic_time)
    if "7:00 PM" not in (graphic_time or "") and "October 27" not in (graphic_time or ""):
        failed += 1
        logging.error("graphic time self-test failed: %s", graphic_time)
    compact_lines = ["3rdfloorFitnessCentre:80", "4thfloorFitnessCentre:45", "CardioMez:20"]
    compact_counts, _ = parse_ocr_counts("", compact_lines)
    if compact_counts != {"3WR": 80, "4WR": 45, "CM": 20}:
        failed += 1
        logging.error("compact OCR self-test failed: %s", compact_counts)
    nosup_lines = ["3floorFitnessCentre:85", "4floorFitnessCentre:36", "CardioMez:19"]
    nosup_counts, _ = parse_ocr_counts(" ".join(nosup_lines), nosup_lines)
    if nosup_counts != {"3WR": 85, "4WR": 36, "CM": 19}:
        failed += 1
        logging.error("no-superscript OCR self-test failed: %s", nosup_counts)
    ath_lines = ["3rdfloorFitnessCentre:105", "AthfloorFitnessCentre:35", "3'floorFitness:176"]
    ath_counts, _ = parse_ocr_counts(" ".join(ath_lines), ath_lines)
    if ath_counts.get("3WR") != 105 or ath_counts.get("4WR") != 35:
        failed += 1
        logging.error("Ath/4th OCR self-test failed: %s", ath_counts)
    if failed:
        logging.error("%s self-test(s) failed", failed)
        return 1
    logging.info("All self-tests passed")
    return 0


def parse_posts(args: argparse.Namespace) -> int:
    if not JSONL_PATH.exists():
        logging.error("Missing scrape JSONL: %s", JSONL_PATH)
        return 1

    records = load_jsonl(JSONL_PATH)
    if args.limit:
        records = records[: args.limit]
    logging.info("Loaded %s posts from %s", len(records), JSONL_PATH)

    n_text = sum(1 for record in records if has_weight_room_counts(parse_text_counts(record.get("full_text") or record.get("text") or "")))
    text_share = n_text / len(records) if records else 1.0
    logging.info(
        "Text occupancy captions: %s/%s (%.1f%%). OCR fallback threshold is 10%% unparsed-from-text.",
        n_text,
        len(records),
        100 * text_share,
    )

    backends: OcrBackends | None = None
    cache: dict[str, dict[str, Any]] = {}
    need_ocr = text_share < 0.90 or args.force_ocr
    if need_ocr:
        logging.info("More than 10%% of posts lack text numbers; running OCR fallback")
        backends = OcrBackends()
        cache = load_ocr_cache(OCR_CACHE_PATH)
        logging.info("OCR cache entries: %s", len(cache))
    else:
        logging.info("Text regex covers >=90%% of posts; skipping OCR unless --force-ocr")

    rows: list[dict[str, Any]] = []
    unparsed: list[dict[str, Any]] = []
    ocr_examples: list[dict[str, Any]] = []
    method_counts: Counter[str] = Counter()
    area_counts: Counter[str] = Counter()
    ocr_done = 0

    for index, record in enumerate(records, start=1):
        counts, method, graphic_time, image_path = parse_record(
            record, backends, cache, args.ocr_engine
        )
        method_counts[method] += 1
        if method.startswith("ocr"):
            ocr_done += 1
            if ocr_done % 25 == 0:
                logging.info("OCR progress: %s image posts", ocr_done)
            ocr_examples.append(
                {
                    "post_id": str(record.get("id") or ""),
                    "timestamp_local": record.get("created_at_local") or "",
                    "image_path": str(image_path.relative_to(ROOT)).replace("\\", "/") if image_path else "",
                    "parse_method": method,
                    "counts_json": json.dumps(counts, sort_keys=True),
                    "ocr_preview": "",
                    "graphic_time_raw": graphic_time or "",
                    "_counts": counts,
                    "_image_path": image_path,
                }
            )
        if not counts:
            unparsed.append(
                {
                    "id": record.get("id"),
                    "created_at_local": record.get("created_at_local"),
                    "text": (record.get("full_text") or record.get("text") or "")[:500],
                    "media_files": record.get("media_files") or [],
                    "parse_method": method,
                    "graphic_time_raw": graphic_time,
                }
            )
            continue
        for area in counts:
            area_counts[area] += 1
        rows.extend(rows_for_record(record, counts, method, graphic_time))

        if index % 200 == 0:
            logging.info("Parsed %s/%s posts; rows so far %s", index, len(records), len(rows))

    rows.sort(key=lambda item: (item["timestamp_local"], item["post_id"], item["area"]))
    write_csv(CSV_PATH, rows, CSV_FIELDS)

    UNPARSED_PATH.parent.mkdir(parents=True, exist_ok=True)
    with UNPARSED_PATH.open("w", encoding="utf-8") as handle:
        for item in unparsed:
            handle.write(json.dumps(item, ensure_ascii=False) + "\n")

    spot_n = min(args.spot_check, len(ocr_examples))
    rng = random.Random(args.seed)
    spot_rows = rng.sample(ocr_examples, spot_n) if spot_n else []
    spot_rows.sort(key=lambda item: item["timestamp_local"])
    for item in spot_rows:
        if backends is None or not item.get("_image_path"):
            continue
        image_path = item["_image_path"]
        used = str(item["parse_method"]).removeprefix("ocr_")
        key = cache_key(used, image_path)
        lines = list((cache.get(key) or {}).get("lines") or [])
        item["ocr_preview"] = " | ".join(lines[:12])
    write_csv(
        SPOTCHECK_PATH,
        [{field: item.get(field, "") for field in SPOTCHECK_FIELDS} for item in spot_rows],
        SPOTCHECK_FIELDS,
    )

    parsed_posts = len(records) - len(unparsed)
    summary = {
        "n_posts": len(records),
        "n_parsed_posts": parsed_posts,
        "n_unparsed_posts": len(unparsed),
        "unparsed_share": round(len(unparsed) / len(records), 4) if records else 0,
        "n_rows": len(rows),
        "text_caption_posts": n_text,
        "ocr_needed": need_ocr,
        "parse_method_counts": dict(method_counts),
        "area_post_counts": dict(area_counts),
        "oldest_local": records[0].get("created_at_local") if records else None,
        "newest_local": records[-1].get("created_at_local") if records else None,
        "csv": str(CSV_PATH.relative_to(ROOT)).replace("\\", "/"),
        "unparsed": str(UNPARSED_PATH.relative_to(ROOT)).replace("\\", "/"),
        "spotcheck": str(SPOTCHECK_PATH.relative_to(ROOT)).replace("\\", "/"),
        "spotcheck_n": spot_n,
        "tesseract_available": backends.tesseract_available() if backends else False,
        "manual_spotcheck": {
            "n": 30,
            "core_3WR_4WR_CM": "30/30 match the cards",
            "review_file": "data/processed/ocr_spotcheck_review.json",
        },
    }
    SUMMARY_PATH.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    logging.info("Wrote %s rows to %s", len(rows), CSV_PATH)
    logging.info("Unparsed posts: %s (%s)", len(unparsed), UNPARSED_PATH)
    logging.info("Spot-check sample: %s rows -> %s", spot_n, SPOTCHECK_PATH)
    logging.info("Summary: %s", json.dumps(summary["parse_method_counts"]))
    return 0 if parsed_posts else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=None, help="Parse only the first N posts (debug)")
    parser.add_argument(
        "--ocr-engine",
        choices=("auto", "tesseract", "rapidocr"),
        default="auto",
        help="auto = Tesseract then RapidOCR if 3WR/4WR are missing",
    )
    parser.add_argument("--force-ocr", action="store_true", help="OCR image posts even if text coverage is high")
    parser.add_argument("--spot-check", type=int, default=30, help="Random OCR rows to write for manual review")
    parser.add_argument("--seed", type=int, default=20261027, help="RNG seed for the spot-check sample")
    parser.add_argument("--self-test", action="store_true", help="Run regex/OCR-parse unit checks and exit")
    return parser


def main() -> int:
    setup_logging()
    args = build_parser().parse_args()
    if args.self_test:
        return run_self_test()
    return parse_posts(args)


if __name__ == "__main__":
    raise SystemExit(main())
