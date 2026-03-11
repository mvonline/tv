#!/usr/bin/env python3
"""
Stream URL Checker
Validates each stream_url in channels.json by sending a HEAD (or GET) request.
Updates the 'working' field to true/false and saves channels.json.
"""

import requests
import json
import time
import logging
import sys
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
log = logging.getLogger(__name__)

CHANNELS_FILE = "channels.json"
REQUEST_TIMEOUT = 10       # seconds per request
MAX_WORKERS = 5            # concurrent checks
REQUEST_DELAY = 0.2        # seconds between sequential requests (non-threaded mode)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
}


def check_stream(channel: dict) -> tuple[str, bool | None]:
    """
    Check if a stream URL is accessible.
    Returns (channel_id, working: bool | None).
    None means no stream_url to check.
    """
    stream_url = channel.get("stream_url")
    channel_id = channel.get("id", "unknown")

    if not stream_url:
        return channel_id, None

    try:
        # Try HEAD first (faster, no body download)
        response = requests.head(
            stream_url,
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT,
            allow_redirects=True,
        )
        if response.status_code < 400:
            log.info(f"  OK [{response.status_code}] {channel['name']}")
            return channel_id, True

        # Some HLS servers reject HEAD — fallback to GET with stream=True
        response = requests.get(
            stream_url,
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT,
            stream=True,
        )
        # Just read the first chunk to verify the stream is alive
        first_chunk = next(response.iter_content(chunk_size=512), None)
        response.close()

        if response.status_code < 400 and first_chunk:
            log.info(f"  OK [{response.status_code}] {channel['name']}")
            return channel_id, True
        else:
            log.warning(f"  FAIL [{response.status_code}] {channel['name']}")
            return channel_id, False

    except requests.exceptions.Timeout:
        log.warning(f"  TIMEOUT {channel['name']}: {stream_url[:60]}...")
        return channel_id, False
    except requests.exceptions.ConnectionError:
        log.warning(f"  CONNECTION ERROR {channel['name']}: {stream_url[:60]}...")
        return channel_id, False
    except requests.exceptions.RequestException as e:
        log.warning(f"  ERROR {channel['name']}: {e}")
        return channel_id, False


def main():
    log.info(f"Loading {CHANNELS_FILE}...")
    try:
        with open(CHANNELS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        log.error(f"{CHANNELS_FILE} not found. Run scraper.py first.")
        sys.exit(1)
    except json.JSONDecodeError as e:
        log.error(f"Invalid JSON in {CHANNELS_FILE}: {e}")
        sys.exit(1)

    channels = data.get("channels", [])
    total = len(channels)
    checkable = [c for c in channels if c.get("stream_url")]
    log.info(f"Total channels: {total}, with stream URLs: {len(checkable)}")

    if not checkable:
        log.warning("No channels with stream URLs to check.")
        return

    # Build a lookup dict for fast update
    results: dict[str, bool | None] = {}

    log.info(f"Checking {len(checkable)} streams with {MAX_WORKERS} workers...")
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_channel = {
            executor.submit(check_stream, ch): ch
            for ch in checkable
        }
        completed = 0
        for future in as_completed(future_to_channel):
            channel_id, working = future.result()
            results[channel_id] = working
            completed += 1
            if completed % 10 == 0:
                log.info(f"  Progress: {completed}/{len(checkable)}")

    # Apply results
    working_count = 0
    broken_count = 0
    for channel in channels:
        cid = channel.get("id")
        if cid in results:
            channel["working"] = results[cid]
            if results[cid] is True:
                working_count += 1
            elif results[cid] is False:
                broken_count += 1

    # Update metadata
    data["checked_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    data["working_streams"] = working_count
    data["broken_streams"] = broken_count

    # Save
    with open(CHANNELS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    log.info(f"\nDone! Working: {working_count}, Broken: {broken_count}, No URL: {total - len(checkable)}")
    log.info(f"Updated {CHANNELS_FILE}")


if __name__ == "__main__":
    main()
