"""Poll westernusc.ca/wsrc-status and append rows to data/raw/live_counts.csv.

The WordPress page has no first-party JSON. Occupancy is a Tagembed widget
(id 2193663) that loads https://api.tagembed.com/embed/posts. Current
@WesternWeightRm posts are image cards, so tweet-text regex runs first and
RapidOCR reads the graphic when the caption has no 3WR/4WR/CM numbers.

Run once (Task Scheduler should invoke this every 30 minutes):

    python scraper/live_poll.py

Register the 30-minute Windows task from this interpreter:

    python scraper/live_poll.py --install-task
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import hmac
import json
import logging
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
CSV_PATH = RAW_DIR / "live_counts.csv"
TAGEMBED_DIR = RAW_DIR / "tagembed"
IMAGE_DIR = TAGEMBED_DIR / "images"
LOG_PATH = RAW_DIR / "live_poll.log"

PAGE_URL = "https://westernusc.ca/wsrc-status/"
WIDGET_ID = "2193663"
POSTS_URL = "https://api.tagembed.com/embed/posts"
SOURCE = "westernusc.ca/wsrc-status"

# Public HMAC key shipped in widget.tagembed.com JS (api.C3v8fpJk / store chunk).
# Same signing the browser widget uses; not a private account credential.
WIDGET_HMAC_SECRET = (
    "84886bb25b753c6bbaab382d7028284923ab5e9094b4d2488497e7c03be0fc9a"
)
API_BRAND = "tagembed"
API_CONTEXT_TYPE = "wall"

TORONTO = ZoneInfo("America/Toronto")
TASK_NAME = "GymElFarol-WSRC-Poller"
USER_AGENT = "gym-elfarol-live-poller/1.0 (+course project; 30min occupancy poll)"

CSV_FIELDS = [
    "polled_at_local",
    "posted_at_local",
    "area",
    "count",
    "source",
    "parse_method",
    "post_url",
    "post_id",
    "graphic_time_raw",
]

# Caption formats seen in Gazette screenshots / older tweets.
TEXT_PATTERNS: list[tuple[str, str]] = [
    (r"3WR\s*[:=]?\s*(\d+)", "3WR"),
    (r"4WR\s*[:=]?\s*(\d+)", "4WR"),
    (r"(?<![A-Z])CM\s*[:=]?\s*(\d+)", "CM"),
    (r"(?<![A-Z])WR\s*[:=]?\s*(\d+)", "WR"),
    (r"SPIN\s*[:=]?\s*(\d+)", "SPIN"),
    (r"(?<![A-Z])WO\s*[:=]?\s*(\d+)", "WO"),
]

# RapidOCR often drops spaces ("3rdfloorFitnessCentre:80").
OCR_PREFIXES: list[tuple[str, str]] = [
    ("3rdfloorfitnesscentre", "3WR"),
    ("4thfloorfitnesscentre", "4WR"),
    ("cardiomezz", "CM"),
    ("cardiomez", "CM"),
    ("womensonlystudio", "WO"),
    ("womensonly", "WO"),
    ("pickleball", "PICKLEBALL"),
    ("basketball", "BASKETBALL"),
    ("volleyball", "VOLLEYBALL"),
    ("badminton", "BADMINTON"),
    ("squash", "SQUASH"),
    ("spin", "SPIN"),
]


def setup_logging() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(LOG_PATH, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )


def now_toronto() -> datetime:
    return datetime.now(TORONTO)


def iso_local(dt: datetime) -> str:
    return dt.astimezone(TORONTO).isoformat(timespec="seconds")


def sign_embed_headers(method: str, path: str, widget_id: str) -> dict[str, str]:
    timestamp = str(int(datetime.now().timestamp()))
    payload = "\n".join(
        [API_BRAND, method.upper(), path, timestamp, API_CONTEXT_TYPE, widget_id]
    )
    signature = hmac.new(
        WIDGET_HMAC_SECRET.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return {
        "x-api-context-id": widget_id,
        "x-api-context-type": API_CONTEXT_TYPE,
        "x-api-context-brand": API_BRAND,
        "X-Api-Timestamp": timestamp,
        "X-Api-Signature": signature,
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    }


def http_get(url: str, headers: dict[str, str] | None = None, timeout: int = 30) -> bytes:
    req = urllib.request.Request(
        url,
        headers=headers or {"User-Agent": USER_AGENT},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read()


def fetch_latest_posts(widget_id: str = WIDGET_ID, post_count: int = 5) -> dict[str, Any]:
    query = urllib.parse.urlencode(
        {"postCount": post_count, "networkId": 0, "page": 1}
    )
    url = f"{POSTS_URL}?{query}"
    headers = sign_embed_headers("GET", "/posts", widget_id)
    raw = http_get(url, headers=headers)
    data = json.loads(raw.decode("utf-8"))
    TAGEMBED_DIR.mkdir(parents=True, exist_ok=True)
    (TAGEMBED_DIR / "latest_posts.json").write_text(
        json.dumps(data, indent=2), encoding="utf-8"
    )
    if not data.get("status"):
        raise RuntimeError(f"Tagembed posts API error: {data}")
    return data


def latest_post(payload: dict[str, Any]) -> dict[str, Any]:
    posts = (payload.get("body") or {}).get("Posts") or []
    if not posts:
        raise RuntimeError("Tagembed returned no posts")
    return posts[0]


def parse_text_counts(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    if not text:
        return counts
    for pattern, area in TEXT_PATTERNS:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            counts[area] = int(match.group(1))
    return counts


def compact_alnum(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def parse_ocr_counts(lines: list[str]) -> tuple[dict[str, int], str | None]:
    counts: dict[str, int] = {}
    graphic_time: str | None = None
    prefixes = sorted(OCR_PREFIXES, key=lambda item: len(item[0]), reverse=True)
    for line in lines:
        compact = compact_alnum(line)
        if "userstats" in compact or (
            "october" in compact and "pm" in compact
        ) or (
            "october" in compact and "am" in compact
        ):
            graphic_time = re.sub(r"\s+", " ", line).strip()
            continue
        for prefix, area in prefixes:
            if not compact.startswith(prefix):
                continue
            rest = compact[len(prefix) :]
            match = re.fullmatch(r"(\d+)", rest)
            if match:
                counts[area] = int(match.group(1))
            break
    return counts, graphic_time


def image_urls(post: dict[str, Any]) -> list[str]:
    media = (post.get("media") or {}).get("image") or {}
    urls: list[str] = []
    for key in ("original", "large", "small"):
        url = media.get(key)
        if url:
            urls.append(url)
    return urls


def download_image(post: dict[str, Any]) -> Path | None:
    urls = image_urls(post)
    if not urls:
        return None
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    dest = IMAGE_DIR / f"{post.get('id', 'latest')}.jpg"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": f"https://widget.tagembed.com/{WIDGET_ID}",
        "Accept": "image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5",
    }
    last_error: Exception | None = None
    for url in urls:
        try:
            dest.write_bytes(http_get(url, headers=headers))
            return dest
        except Exception as exc:  # noqa: BLE001 — try CDN fallbacks
            last_error = exc
            logging.warning("Image download failed for %s: %s", url[:80], exc)
    if last_error:
        logging.warning("Could not download occupancy card image: %s", last_error)
    return None


def ocr_lines(image_path: Path) -> list[str]:
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        logging.warning(
            "rapidocr-onnxruntime is not installed; cannot OCR the occupancy card. "
            "pip install -r scraper/requirements.txt"
        )
        return []
    engine = RapidOCR()
    result, _elapse = engine(str(image_path))
    if not result:
        return []
    lines: list[str] = []
    for row in result:
        if isinstance(row, (list, tuple)) and len(row) >= 2:
            lines.append(str(row[1]))
    return lines


def posted_at_local(post: dict[str, Any]) -> str:
    created = post.get("createdAt")
    if created is None:
        return ""
    return iso_local(datetime.fromtimestamp(int(created), tz=timezone.utc))


def append_rows(rows: list[dict[str, Any]]) -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    new_file = not CSV_PATH.exists() or CSV_PATH.stat().st_size == 0
    with CSV_PATH.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        if new_file:
            writer.writeheader()
        for row in rows:
            writer.writerow(row)


def extract_counts(post: dict[str, Any]) -> tuple[dict[str, int], str, str | None]:
    text = ((post.get("content") or {}).get("text") or "").strip()
    counts = parse_text_counts(text)
    if counts:
        return counts, "tweet_text", None

    image_path = download_image(post)
    if image_path is None:
        return {}, "unparsed", None
    lines = ocr_lines(image_path)
    logging.info("OCR lines: %s", lines)
    counts, graphic_time = parse_ocr_counts(lines)
    if counts:
        return counts, "ocr_image", graphic_time
    return {}, "unparsed", graphic_time


def poll_once() -> int:
    polled_at = iso_local(now_toronto())
    payload = fetch_latest_posts()
    post = latest_post(payload)
    counts, parse_method, graphic_time = extract_counts(post)
    posted = posted_at_local(post)
    post_url = post.get("link") or PAGE_URL
    post_id = str(post.get("id") or "")

    if not counts:
        logging.warning(
            "No numeric occupancy parsed (method=%s). Raw JSON saved to %s",
            parse_method,
            TAGEMBED_DIR / "latest_posts.json",
        )
        append_rows(
            [
                {
                    "polled_at_local": polled_at,
                    "posted_at_local": posted,
                    "area": "",
                    "count": "",
                    "source": SOURCE,
                    "parse_method": parse_method,
                    "post_url": post_url,
                    "post_id": post_id,
                    "graphic_time_raw": graphic_time or "",
                }
            ]
        )
        return 1

    rows = [
        {
            "polled_at_local": polled_at,
            "posted_at_local": posted,
            "area": area,
            "count": count,
            "source": SOURCE,
            "parse_method": parse_method,
            "post_url": post_url,
            "post_id": post_id,
            "graphic_time_raw": graphic_time or "",
        }
        for area, count in counts.items()
    ]
    append_rows(rows)
    logging.info(
        "Wrote %d rows to %s (%s): %s",
        len(rows),
        CSV_PATH,
        parse_method,
        counts,
    )
    return 0


def task_xml(python: str, script: Path, start: datetime) -> str:
    start_boundary = start.strftime("%Y-%m-%dT%H:%M:%S")
    return f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Poll westernusc.ca/wsrc-status every 30 minutes into data/raw/live_counts.csv</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>PT30M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>{start_boundary}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{python}</Command>
      <Arguments>"{script}"</Arguments>
      <WorkingDirectory>{script.parent.parent}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"""


def install_task() -> int:
    script = Path(__file__).resolve()
    python = sys.executable
    xml_path = script.parent / "wsrc_poller_task.xml"
    xml_path.write_text(task_xml(python, script, now_toronto()), encoding="utf-16")
    logging.info("Creating scheduled task %s every 30 minutes", TASK_NAME)
    completed = subprocess.run(
        ["schtasks", "/Create", "/TN", TASK_NAME, "/F", "/XML", str(xml_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        logging.error("schtasks failed: %s%s", completed.stdout, completed.stderr)
        return completed.returncode
    logging.info("%s", completed.stdout.strip() or "Task created.")
    query = subprocess.run(
        ["schtasks", "/Query", "/TN", TASK_NAME, "/FO", "LIST", "/V"],
        capture_output=True,
        text=True,
        check=False,
    )
    logging.info("Task status:\n%s", query.stdout)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--install-task",
        action="store_true",
        help="Register a Windows Task Scheduler job that runs this script every 30 minutes",
    )
    parser.add_argument(
        "--query-task",
        action="store_true",
        help="Print the Windows scheduled task status and exit",
    )
    return parser.parse_args()


def main() -> int:
    setup_logging()
    args = parse_args()
    if args.query_task:
        completed = subprocess.run(
            ["schtasks", "/Query", "/TN", TASK_NAME, "/FO", "LIST", "/V"],
            capture_output=True,
            text=True,
            check=False,
        )
        sys.stdout.write(completed.stdout)
        sys.stderr.write(completed.stderr)
        return completed.returncode
    if args.install_task:
        return install_task()
    try:
        return poll_once()
    except urllib.error.HTTPError as exc:
        body = exc.read()[:500]
        logging.exception("HTTP %s: %s", exc.code, body)
        return 1
    except Exception:
        logging.exception("Live poll failed")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
