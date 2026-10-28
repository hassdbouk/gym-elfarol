# Scrapers

## Live poller (`live_poll.py`) — start this week

`https://westernusc.ca/wsrc-status/` is a WordPress page. It does **not**
expose a first-party JSON occupancy API. The numbers come from a Tagembed
social widget:

| Piece | Value |
| --- | --- |
| Widget embed | `<div class="tagembed-widget" data-widget-id="2193663">` |
| Widget URL | `https://widget.tagembed.com/2193663` |
| Data endpoint | `GET https://api.tagembed.com/embed/posts` |
| Auth | HMAC headers copied from the public widget JS (`X-Api-Timestamp`, `X-Api-Signature`, `x-api-context-id=2193663`) |

As of Oct 2026 the latest `@WesternWeightRm` item is an **image card** (caption
is only a `t.co` link). The poller:

1. Pulls the latest widget post.
2. Tries tweet-text regex (`3WR 42`, `4WR 6`, `CM 17`, …).
3. If that fails, downloads the card and OCRs it with RapidOCR.
4. Appends long rows to `data/raw/live_counts.csv`.

Raw JSON is overwritten at `data/raw/tagembed/latest_posts.json`. Images land
in `data/raw/tagembed/images/`. Both are gitignored.

### Install and run once

```powershell
cd "Multi Agent\Project\gym-elfarol"
pip install -r scraper/requirements.txt
python scraper/live_poll.py
```

CSV columns: `polled_at_local, posted_at_local, area, count, source, parse_method, post_url, post_id, graphic_time_raw`.

Area codes: `3WR` / `4WR` (weight rooms), `CM` (cardio mezz), `SPIN`, `WO`, plus
court sports when the graphic includes them. Cleaning should decide whether CM
is in-scope; the poller records it.

### 30-minute Windows Task Scheduler job

```powershell
python scraper/live_poll.py --install-task
# or
powershell -ExecutionPolicy Bypass -File scraper/register_windows_task.ps1
```

Task name: `GymElFarol-WSRC-Poller`. It only runs while this Windows account is
logged on. Check it with:

```powershell
python scraper/live_poll.py --query-task
```

Logs: `data/raw/live_poll.log`.

If X scraping is blocked, this poller still yields ~3.5 weeks of structured
counts between now and the Nov 23 report, provided the PC is on around gym
hours.

## X historical scrape (`x_scrape.py`)

Uses **twifork** (drop-in `twikit` Client) plus a local X session. Put cookies in `scraper/cookies.json`
(gitignored) — never commit them and never paste them into chat.

Cookie-Editor's Chrome export is a list of objects. `twikit` wants a flat map.
The script accepts either and rewrites the file if needed. The required keys
are `auth_token` and `ct0`:

```json
{
  "auth_token": "...",
  "ct0": "..."
}
```

### Confirm format (first 50 posts)

```powershell
cd "Multi Agent\Project\gym-elfarol"
pip install -r scraper/requirements.txt
python scraper/x_scrape.py --limit 50 --probe
```

Writes `data/raw/x/westernweightrm_posts.jsonl`, downloads images to
`data/raw/x/media/`, and summarises text-vs-image mix in
`data/raw/x/format_probe.json`.

**Format (confirmed Oct 2026):** the first 50 current posts are all **image
cards** (caption is only a `t.co` link). Text occupancy tweets
(`3WR: 36` / `4WR: 9` / `CM: 13`) appear through about **21 Sep 2025**,
then the account switched to graphics. The later parser should regex the
caption first and OCR the image when that fails.

### Historical scrape (back to Sept 2025)

```powershell
python scraper/x_scrape.py --until 2025-09-01
```

Safe to re-run: already-saved tweet IDs are skipped. Sleeps a few seconds
between pages. If X rate-limits (HTTP 429), it waits 90s once and then stops
so progress stays on disk.

The profile timeline often stops before `--until`. The script then searches
`from:WesternWeightRm` for the remaining window. To run only that fill:

```powershell
python scraper/x_scrape.py --until 2025-09-01 --search-only
```

## Historical parser (`parse_posts.py`)

Turns `data/raw/x/westernweightrm_posts.jsonl` into a long occupancy table.

1. Regex on the caption (`3WR 42`, `4WR 6`, `CM 17`, `WR3 114`, `W.O 15`, …).
2. If more than 10% of posts have no text numbers (true of this corpus: most
   posts after ~21 Sep 2025 are image cards), OCR the downloaded photo.
3. Tesseract is first (inverted purple graphic, digit+letter whitelist). If
   Tesseract is missing or does not recover 3WR/4WR, RapidOCR is the fallback.

```powershell
python scraper/parse_posts.py --self-test
python scraper/parse_posts.py
```

Writes:

| File | What |
| --- | --- |
| `data/processed/occupancy_long.csv` | `timestamp_local, area, count, source` plus `parse_method`, `post_id`, `graphic_time_raw` |
| `data/processed/unparsed_posts.jsonl` | posts with no usable counts (announcements, OCR misses) |
| `data/processed/ocr_spotcheck.csv` | 30 random OCR rows for manual review |
| `data/processed/parse_summary.json` | coverage stats |
| `data/raw/x/ocr_cache.jsonl` | cached OCR lines so re-runs skip images (gitignored) |

Tesseract binary: `winget install UB-Mannheim.TesseractOCR`, or extract the
installer into `%LOCALAPPDATA%\Tesseract-OCR\` so `tesseract.exe` sits next to
`tessdata\eng.traineddata`. `pytesseract` is in `scraper/requirements.txt`.
