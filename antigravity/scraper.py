"""
scraper.py — ParsaTV channel scraper
Scrapes http://parsatv.com/ to extract Iranian TV channel metadata and stream URLs.
Output: channels.json
"""

import json
import re
import time
from datetime import datetime, timezone
from urllib.parse import urljoin, quote

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.parsatv.com"
OUTPUT_FILE = "channels.json"
REQUEST_DELAY = 1  # seconds between requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9,fa;q=0.8",
}

# Language inference based on category name
LANGUAGE_MAP = {
    "persian": "fa",
    "farsi": "fa",
    "news": "fa",
    "sport": "fa",
    "music": "fa",
    "kids": "fa",
    "movie": "fa",
    "film": "fa",
    "series": "fa",
    "english": "en",
    "arabic": "ar",
    "kurdish": "ku",
    "german": "de",
    "turkish": "tr",
    "french": "fr",
}


def slugify(text: str) -> str:
    """Convert text to a URL-friendly slug."""
    text = text.lower().strip()
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"[^\w\-]", "", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


def infer_language(category: str) -> str:
    """Infer language from category name."""
    cat_lower = category.lower()
    for keyword, lang in LANGUAGE_MAP.items():
        if keyword in cat_lower:
            return lang
    return "fa"  # default to Farsi


def get_page(url: str, session: requests.Session) -> BeautifulSoup | None:
    """Fetch a URL and return a BeautifulSoup object, or None on failure."""
    try:
        resp = session.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "lxml")
    except requests.RequestException as e:
        print(f"  [ERROR] Failed to fetch {url}: {e}")
        return None


def extract_stream_url(soup: BeautifulSoup, page_url: str) -> str | None:
    """
    Try to extract a stream URL (.m3u8, .mp4) from a channel page.
    Checks: <source>, <video>, iframe src, and JS variable patterns.
    """
    # 1. Look for <source> tags
    for source in soup.find_all("source"):
        src = source.get("src", "")
        if src and (".m3u8" in src or ".mp4" in src):
            return src

    # 2. Look for <video> tags
    for video in soup.find_all("video"):
        src = video.get("src", "")
        if src and (".m3u8" in src or ".mp4" in src):
            return src

    # 3. Look inside <script> tags for stream URL patterns
    for script in soup.find_all("script"):
        if not script.string:
            continue
        text = script.string

        # Match common patterns like: file: "...", src: "...", source: "..."
        patterns = [
            r'["\']?(?:file|src|source|url|stream)["\']?\s*[:=]\s*["\']([^"\']+\.m3u8[^"\']*)["\']',
            r'["\']?(?:file|src|source|url|stream)["\']?\s*[:=]\s*["\']([^"\']+\.mp4[^"\']*)["\']',
            r'(https?://[^\s"\'<>]+\.m3u8[^\s"\'<>]*)',
            r'(https?://[^\s"\'<>]+\.mp4[^\s"\'<>]*)',
        ]
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                url_found = match.group(1)
                return url_found

    # 4. Look for iframes (some sites embed players)
    for iframe in soup.find_all("iframe"):
        src = iframe.get("src", "")
        if src and ("player" in src or "embed" in src or "video" in src):
            print(f"  [INFO] Found iframe player: {src}")
            # Return iframe src as fallback — stream_checker will validate
            return None  # Can't easily fetch from iframe without JS

    return None


def scrape_channel_page(url: str, session: requests.Session) -> str | None:
    """Visit a channel page and return its stream URL."""
    soup = get_page(url, session)
    if not soup:
        return None
    return extract_stream_url(soup, url)


def scrape_homepage(session: requests.Session) -> list[dict]:
    """
    Parse the ParsaTV homepage to collect all channels grouped by category.
    Returns a list of dicts: {name, category, logo_url, page_url}
    """
    print(f"[*] Fetching homepage: {BASE_URL}")
    soup = get_page(BASE_URL, session)
    if not soup:
        print("[FATAL] Could not load homepage. Aborting.")
        return []

    channels = []
    seen_urls = set()

    # Strategy 1: Look for category sections with channel links
    # Common patterns on TV listing sites
    category_sections = soup.find_all(
        ["section", "div", "ul"],
        class_=re.compile(r"categor|channel|list|grid|group|section", re.IGNORECASE),
    )

    for section in category_sections:
        # Try to find a category heading
        heading = section.find(["h1", "h2", "h3", "h4", "h5", "li", "span", "a"])
        category = heading.get_text(strip=True) if heading else "General"
        if len(category) > 50:
            category = "General"

        # Find channel links within the section
        links = section.find_all("a", href=True)
        for link in links:
            href = link.get("href", "")
            if not href or href == "#":
                continue

            full_url = urljoin(BASE_URL, href)
            if full_url in seen_urls:
                continue

            # Filter for channel page URLs (e.g. contains "name=" or channel slug)
            if "parsatv.com" not in full_url:
                continue

            # Try to get channel name
            name = link.get_text(strip=True)
            if not name:
                img = link.find("img")
                if img:
                    name = img.get("alt", "").strip() or img.get("title", "").strip()
            if not name or len(name) < 2:
                continue

            # Try to get logo URL
            logo_url = None
            img = link.find("img")
            if img:
                logo_url = img.get("src") or img.get("data-src") or img.get("data-lazy-src")
                if logo_url:
                    logo_url = urljoin(BASE_URL, logo_url)

            seen_urls.add(full_url)
            channels.append(
                {
                    "name": name,
                    "category": category,
                    "logo_url": logo_url,
                    "page_url": full_url,
                }
            )

    # Strategy 2: Fallback — scan ALL links matching channel URL pattern
    if len(channels) < 5:
        print("[*] Fallback: scanning all links for channel patterns...")
        all_links = soup.find_all("a", href=re.compile(r"name=|/channel/|/tv/", re.IGNORECASE))
        for link in all_links:
            href = link.get("href", "")
            full_url = urljoin(BASE_URL, href)
            if full_url in seen_urls:
                continue

            name = link.get_text(strip=True)
            img = link.find("img")
            if not name and img:
                name = img.get("alt", "").strip()
            if not name or len(name) < 2:
                continue

            logo_url = None
            if img:
                logo_url = img.get("src") or img.get("data-src")
                if logo_url:
                    logo_url = urljoin(BASE_URL, logo_url)

            seen_urls.add(full_url)
            channels.append(
                {
                    "name": name,
                    "category": "General",
                    "logo_url": logo_url,
                    "page_url": full_url,
                }
            )

    print(f"[*] Found {len(channels)} channel entries on homepage.")
    return channels


def build_channels_json(raw_channels: list[dict], session: requests.Session) -> dict:
    """
    Visit each channel page to get stream URLs, then build final JSON.
    """
    result_channels = []

    for i, ch in enumerate(raw_channels, 1):
        name = ch["name"]
        page_url = ch["page_url"]
        category = ch.get("category", "General")

        print(f"[{i}/{len(raw_channels)}] Processing: {name} — {page_url}")
        stream_url = scrape_channel_page(page_url, session)

        result_channels.append(
            {
                "id": slugify(name),
                "name": name,
                "category": category,
                "subcategory": None,
                "language": infer_language(category),
                "logo_url": ch.get("logo_url"),
                "stream_url": stream_url,
                "page_url": page_url,
                "working": None,
            }
        )

        time.sleep(REQUEST_DELAY)

    return {
        "scraped_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total": len(result_channels),
        "channels": result_channels,
    }


def main():
    print("=" * 60)
    print("ParsaTV Channel Scraper")
    print("=" * 60)

    with requests.Session() as session:
        raw_channels = scrape_homepage(session)

        if not raw_channels:
            print("[WARN] No channels found on homepage. Writing empty output.")
            output = {
                "scraped_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "total": 0,
                "channels": [],
            }
        else:
            output = build_channels_json(raw_channels, session)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n[✓] Done! Saved {output['total']} channels to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
