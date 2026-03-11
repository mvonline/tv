"""
stream_checker.py — Stream URL validator for channels.json
Sends HEAD requests to each stream_url and sets working: true/false.
Updates channels.json in place.
"""

import json
import time

import requests

INPUT_FILE = "channels.json"
REQUEST_TIMEOUT = 10  # seconds
REQUEST_DELAY = 0.5  # seconds between requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
}


def check_stream(url: str, session: requests.Session) -> bool:
    """Return True if the stream URL responds with a 2xx or 3xx status code."""
    try:
        resp = session.head(url, headers=HEADERS, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        return resp.status_code < 400
    except requests.RequestException:
        try:
            # Some servers don't support HEAD — try GET with stream=True
            resp = session.get(
                url,
                headers=HEADERS,
                timeout=REQUEST_TIMEOUT,
                stream=True,
                allow_redirects=True,
            )
            resp.close()
            return resp.status_code < 400
        except requests.RequestException:
            return False


def main():
    print("=" * 60)
    print("Stream Checker")
    print("=" * 60)

    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    channels = data.get("channels", [])
    total = len(channels)
    working_count = 0
    skipped_count = 0

    with requests.Session() as session:
        for i, ch in enumerate(channels, 1):
            stream_url = ch.get("stream_url")
            name = ch.get("name", "Unknown")

            if not stream_url:
                ch["working"] = False
                skipped_count += 1
                print(f"[{i}/{total}] SKIP  (no stream_url): {name}")
                continue

            result = check_stream(stream_url, session)
            ch["working"] = result

            if result:
                working_count += 1
                status = "OK   "
            else:
                status = "FAIL "

            print(f"[{i}/{total}] {status} {name} — {stream_url[:60]}")
            time.sleep(REQUEST_DELAY)

    with open(INPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n[✓] Done! {working_count}/{total - skipped_count} streams working.")
    print(f"    {skipped_count} channels had no stream URL.")
    print(f"    Updated {INPUT_FILE}")


if __name__ == "__main__":
    main()
