"""Scrape @WesternWeightRm posts with twikit and local session cookies.

Cookies live in scraper/cookies.json (gitignored). Cookie-Editor exports are
accepted and rewritten to twikit's flat {name: value} map on load.

Examples:

    python scraper/x_scrape.py --limit 50 --probe
    python scraper/x_scrape.py --until 2025-09-01
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import random
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw" / "x"
JSONL_PATH = RAW_DIR / "westernweightrm_posts.jsonl"
MEDIA_DIR = RAW_DIR / "media"
PROBE_PATH = RAW_DIR / "format_probe.json"
LOG_PATH = RAW_DIR / "x_scrape.log"
DEFAULT_COOKIES = Path(__file__).resolve().parent / "cookies.json"

SCREEN_NAME = "WesternWeightRm"
TORONTO = ZoneInfo("America/Toronto")
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
)

# Same occupancy tokens the live poller / future parser look for.
COUNT_RE = re.compile(
    r"(3WR|4WR|(?<![A-Z])CM|(?<![A-Z])WR|SPIN|(?<![A-Z])WO)\s*[:=]?\s*\d+",
    re.IGNORECASE,
)
TCO_ONLY_RE = re.compile(r"^\s*https?://t\.co/\S+\s*$", re.IGNORECASE)


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


def load_cookie_map(path: Path) -> dict[str, str]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        cookies = {str(k): str(v) for k, v in raw.items() if v is not None}
    elif isinstance(raw, list):
        cookies = {
            item["name"]: item["value"]
            for item in raw
            if isinstance(item, dict) and item.get("name") is not None
        }
        path.write_text(json.dumps(cookies, indent=2) + "\n", encoding="utf-8")
        logging.info("Rewrote Cookie-Editor export at %s to twikit dict format", path)
    else:
        raise ValueError(f"Unsupported cookies.json shape: {type(raw).__name__}")

    missing = [name for name in ("auth_token", "ct0") if name not in cookies]
    if missing:
        raise ValueError(f"cookies.json is missing {missing}")
    return cookies


def existing_ids(path: Path) -> set[str]:
    ids: set[str] = set()
    if not path.exists():
        return ids
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                ids.add(str(json.loads(line)["id"]))
            except (json.JSONDecodeError, KeyError, TypeError):
                continue
    return ids


def parse_until(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d").replace(
        tzinfo=TORONTO, hour=0, minute=0, second=0
    )


def tweet_created_local(tweet: Any) -> datetime | None:
    created = getattr(tweet, "created_at_datetime", None)
    if created is None:
        return None
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return created.astimezone(TORONTO)


def media_items(tweet: Any) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for index, media in enumerate(getattr(tweet, "media", None) or []):
        items.append(
            {
                "index": index,
                "type": getattr(media, "type", None),
                "url": getattr(media, "media_url", None),
            }
        )
    return items


def tweet_to_record(tweet: Any) -> dict[str, Any]:
    created_local = tweet_created_local(tweet)
    user = getattr(tweet, "user", None)
    retweeted = getattr(tweet, "retweeted_tweet", None)
    quote = getattr(tweet, "quote", None)
    return {
        "id": str(tweet.id),
        "created_at": getattr(tweet, "created_at", None),
        "created_at_local": created_local.isoformat() if created_local else None,
        "text": getattr(tweet, "text", None),
        "full_text": getattr(tweet, "full_text", None),
        "lang": getattr(tweet, "lang", None),
        "urls": getattr(tweet, "urls", None),
        "hashtags": getattr(tweet, "hashtags", None),
        "has_card": getattr(tweet, "has_card", None),
        "thumbnail_url": getattr(tweet, "thumbnail_url", None),
        "media": media_items(tweet),
        "favorite_count": getattr(tweet, "favorite_count", None),
        "retweet_count": getattr(tweet, "retweet_count", None),
        "reply_count": getattr(tweet, "reply_count", None),
        "view_count": getattr(tweet, "view_count", None),
        "user_screen_name": getattr(user, "screen_name", None) if user else None,
        "is_quote": getattr(tweet, "is_quote_status", None),
        "quoted_tweet_id": str(quote.id) if quote is not None else None,
        "retweeted_tweet_id": str(retweeted.id) if retweeted is not None else None,
    }


def classify_post(record: dict[str, Any]) -> str:
    text = (record.get("full_text") or record.get("text") or "").strip()
    has_counts = bool(COUNT_RE.search(text))
    has_media = bool(record.get("media"))
    if has_counts and has_media:
        return "text_and_image"
    if has_counts:
        return "text_counts"
    if has_media and (not text or TCO_ONLY_RE.match(text)):
        return "image_card"
    if has_media:
        return "image_plus_other_text"
    if TCO_ONLY_RE.match(text):
        return "link_only"
    if text:
        return "text_other"
    return "empty"


def write_probe(records: list[dict[str, Any]], path: Path) -> dict[str, Any]:
    counts: dict[str, int] = {}
    samples: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        kind = classify_post(record)
        counts[kind] = counts.get(kind, 0) + 1
        bucket = samples.setdefault(kind, [])
        if len(bucket) < 3:
            bucket.append(
                {
                    "id": record["id"],
                    "created_at_local": record.get("created_at_local"),
                    "text": (record.get("full_text") or record.get("text") or "")[:240],
                    "media_types": [item.get("type") for item in record.get("media") or []],
                }
            )

    probe = {
        "n": len(records),
        "counts": counts,
        "oldest_local": records[-1].get("created_at_local") if records else None,
        "newest_local": records[0].get("created_at_local") if records else None,
        "samples": samples,
        "recommendation": (
            "Posts are image occupancy cards; parser should OCR media and "
            "only treat caption regex as a bonus."
            if counts.get("image_card", 0) >= max(1, len(records) // 2)
            else "Text regex may be enough; keep OCR as fallback for image posts."
        ),
    }
    path.write_text(json.dumps(probe, indent=2) + "\n", encoding="utf-8")
    return probe


async def download_media(tweet: Any, dest_dir: Path) -> list[str]:
    saved: list[str] = []
    dest_dir.mkdir(parents=True, exist_ok=True)
    for index, media in enumerate(getattr(tweet, "media", None) or []):
        media_type = getattr(media, "type", "")
        if media_type == "photo":
            path = dest_dir / f"{tweet.id}_{index}.jpg"
            if not path.exists():
                await media.download(str(path))
            saved.append(str(path.relative_to(ROOT)))
        elif media_type in {"video", "animated_gif"}:
            path = dest_dir / f"{tweet.id}_{index}.mp4"
            streams = getattr(media, "streams", None) or []
            if streams and not path.exists():
                await streams[-1].download(str(path))
            if path.exists():
                saved.append(str(path.relative_to(ROOT)))
    return saved


async def sleep_politely(base: float) -> None:
    await asyncio.sleep(base + random.uniform(0.4, 1.6))


def oldest_local_on_disk(path: Path) -> datetime | None:
    oldest: datetime | None = None
    if not path.exists():
        return None
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line).get("created_at_local")
            except json.JSONDecodeError:
                continue
            if not raw:
                continue
            created = datetime.fromisoformat(raw)
            if oldest is None or created < oldest:
                oldest = created
    return oldest


async def scrape(args: argparse.Namespace) -> int:
    try:
        from twikit import Client
        from twikit.errors import TooManyRequests, Unauthorized
    except ImportError:
        logging.error("twikit is not installed. Run: pip install -r scraper/requirements.txt")
        return 1

    cookies_path = Path(args.cookies)
    if not cookies_path.exists():
        logging.error("Missing cookies file: %s", cookies_path)
        return 1

    cookies = load_cookie_map(cookies_path)
    until = parse_until(args.until)
    seen = existing_ids(JSONL_PATH)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)

    client = Client("en-US", user_agent=USER_AGENT)
    client.set_cookies(cookies)

    try:
        user = await client.get_user_by_screen_name(args.screen_name)
    except Unauthorized:
        logging.error("X rejected the session cookies. Re-export auth_token and ct0 from a logged-in browser.")
        return 1

    logging.info("Resolved @%s -> user id %s", args.screen_name, user.id)

    new_records: list[dict[str, Any]] = []
    kept = 0
    skipped_existing = 0
    reached_until = False

    async def persist(tweet: Any, out: Any) -> bool:
        nonlocal kept, skipped_existing, reached_until
        created_local = tweet_created_local(tweet)
        if until and created_local is not None and created_local < until:
            reached_until = True
            return False
        if str(tweet.id) in seen:
            skipped_existing += 1
            return True
        record = tweet_to_record(tweet)
        if not args.no_media:
            try:
                record["media_files"] = await download_media(tweet, MEDIA_DIR)
            except Exception as exc:  # media URLs expire; keep the JSON row
                logging.warning("Media download failed for %s: %s", tweet.id, exc)
                record["media_files"] = []
        else:
            record["media_files"] = []
        out.write(json.dumps(record, ensure_ascii=False) + "\n")
        out.flush()
        seen.add(str(tweet.id))
        new_records.append(record)
        kept += 1
        return not (args.limit and kept >= args.limit)

    async def paginate(tweets: Any, label: str) -> None:
        nonlocal reached_until
        pages = 0
        while tweets:
            pages += 1
            page_ids: list[str] = []
            stop = False
            for tweet in tweets:
                page_ids.append(str(tweet.id))
                if not await persist(tweet, out):
                    stop = True
                    break
            logging.info(
                "%s page %s: saw %s tweets, wrote %s new this run, oldest_id=%s",
                label,
                pages,
                len(page_ids),
                kept,
                page_ids[-1] if page_ids else None,
            )
            if stop or (until and reached_until) or (args.limit and kept >= args.limit):
                if reached_until:
                    logging.info("Reached --until %s", args.until)
                break
            try:
                await sleep_politely(args.sleep)
                nxt = await tweets.next()
            except TooManyRequests:
                logging.warning("Rate limited; sleeping 90s before retry")
                await asyncio.sleep(90)
                try:
                    nxt = await tweets.next()
                except TooManyRequests:
                    logging.error("Still rate limited after retry; stopping so progress is saved")
                    break
            if not nxt:
                logging.info("%s ended", label.capitalize())
                break
            tweets = nxt

    with JSONL_PATH.open("a", encoding="utf-8") as out:
        if not args.search_only:
            tweets = await client.get_user_tweets(
                user.id, "Tweets", count=min(args.page_size, 40)
            )
            await paginate(tweets, "timeline")

        oldest = oldest_local_on_disk(JSONL_PATH)
        need_search = bool(until) and (args.search_only or oldest is None or oldest > until)
        if need_search and not (args.limit and kept >= args.limit):
            search_until = (oldest or datetime.now(TORONTO)).date().isoformat()
            logging.info(
                "Searching from:%s since:%s until:%s (profile timeline does not go this far)",
                args.screen_name,
                args.until,
                search_until,
            )
            await sleep_politely(args.sleep)
            search = await client.search_tweets_by_date(
                f"from:{args.screen_name}",
                since=args.until,
                until=search_until,
                product="Latest",
                count=20,
            )
            await paginate(search, "search")

    probe = None
    if args.probe:
        probe_records = new_records
        if not probe_records and JSONL_PATH.exists():
            with JSONL_PATH.open(encoding="utf-8") as handle:
                probe_records = [json.loads(line) for line in handle if line.strip()][: args.limit or 50]
        probe = write_probe(probe_records, PROBE_PATH)
        logging.info("Format probe: %s", json.dumps(probe["counts"]))
        logging.info("Recommendation: %s", probe["recommendation"])

    logging.info(
        "Done. new=%s skipped_existing=%s total_on_disk=%s jsonl=%s",
        kept,
        skipped_existing,
        len(seen),
        JSONL_PATH,
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Scrape @WesternWeightRm with twikit cookies")
    parser.add_argument("--cookies", default=str(DEFAULT_COOKIES), help="Path to cookies.json")
    parser.add_argument("--screen-name", default=SCREEN_NAME)
    parser.add_argument("--limit", type=int, default=None, help="Stop after this many newly written posts")
    parser.add_argument("--until", help="Inclusive local date YYYY-MM-DD; stop when older")
    parser.add_argument(
        "--search-only",
        action="store_true",
        help="Skip the profile timeline and use X search to fill a date gap",
    )
    parser.add_argument("--probe", action="store_true", help="Write format_probe.json for the fetched posts")
    parser.add_argument("--no-media", action="store_true", help="Skip media downloads")
    parser.add_argument("--sleep", type=float, default=3.0, help="Base seconds between timeline pages")
    parser.add_argument("--page-size", type=int, default=40)
    return parser


def main() -> int:
    setup_logging()
    return asyncio.run(scrape(build_parser().parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
