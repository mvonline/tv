"""
scraper.py — ParsaTV channel scraper
Scrapes http://parsatv.com/ to extract Iranian TV channel metadata and stream URLs.

Strategy (in order):
  1. Detect the parsatv PHP stream-fetch endpoint embedded in the page JS
     (e.g. /streams/fetch/asg/sh3.php) and call it with a proper Referer header.
     These endpoints return a JSON/JS blob containing the proxied .m3u8 URL.
  2. Scan <script> blocks for .m3u8 / .mp4 URLs (JWPlayer, VideoJS, etc.)
  3. Follow <iframe> sources and repeat.

Output: channels.json
"""

import json
import re
import time
from datetime import datetime, timezone
from urllib.parse import urljoin, quote

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

BASE_URL = "https://www.parsatv.com"
OUTPUT_FILE = "channels.json"
REQUEST_DELAY = 1  # seconds between requests
MAX_CHANNELS = None  # limit for testing; set to None to scrape all

# Requests timeouts:
# - Connect timeout: fail fast if host is unreachable
# - Read timeout: allow slower responses once connected
CONNECT_TIMEOUT_S = 5
READ_TIMEOUT_S = 20

# When "following" embedded iframes, skip aggressively to avoid stalling.
FOLLOW_CONNECT_TIMEOUT_S = 2
FOLLOW_READ_TIMEOUT_S = 8

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9,fa;q=0.8",
}

# Retry transient transport failures that occasionally happen on parsatv
# (e.g. connection reset mid-handshake / temporary 5xx responses).
RETRY_TOTAL = 3
RETRY_BACKOFF_FACTOR = 0.7
RETRY_STATUS_CODES = (429, 500, 502, 503, 504)

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

# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

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


def get_page(
    url: str,
    session: requests.Session,
    extra_headers: dict | None = None,
    timeout: tuple[float, float] | None = None,
) -> BeautifulSoup | None:
    """Fetch a URL and return a BeautifulSoup object, or None on failure."""
    hdrs = {**HEADERS, **(extra_headers or {})}
    try:
        resp = session.get(
            url,
            headers=hdrs,
            timeout=timeout or (CONNECT_TIMEOUT_S, READ_TIMEOUT_S),
        )
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "lxml")
    except requests.RequestException as e:
        print(f"  [ERROR] Failed to fetch {url}: {e}")
        return None


def get_raw(
    url: str,
    session: requests.Session,
    extra_headers: dict | None = None,
    timeout: tuple[float, float] | None = None,
) -> str | None:
    """Fetch a URL and return the raw response text."""
    hdrs = {**HEADERS, **(extra_headers or {})}
    try:
        resp = session.get(
            url,
            headers=hdrs,
            timeout=timeout or (CONNECT_TIMEOUT_S, READ_TIMEOUT_S),
        )
        resp.raise_for_status()
        return resp.text
    except requests.RequestException as e:
        print(f"  [ERROR] Failed to fetch {url}: {e}")
        return None


def configure_session(session: requests.Session) -> requests.Session:
    """Attach retry-enabled adapters to a requests session."""
    retry = Retry(
        total=RETRY_TOTAL,
        connect=RETRY_TOTAL,
        read=RETRY_TOTAL,
        backoff_factor=RETRY_BACKOFF_FACTOR,
        status_forcelist=RETRY_STATUS_CODES,
        allowed_methods=frozenset({"GET", "HEAD"}),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


# ─────────────────────────────────────────────────────────────
# Stream URL extraction patterns
# ─────────────────────────────────────────────────────────────

# Ordered regex patterns to search inside <script> blocks.
# Group(1) captures the stream URL.
JS_STREAM_PATTERNS = [
    # Direct .m3u8 / .mp4 / .mp3 URLs in any quote context
    r'"(https?://[^\s"\'<>]+\.m3u8(?:[?#][^\s"\'<>]*)?)"',
    r'"(https?://[^\s"\'<>]+\.mp4(?:[?#][^\s"\'<>]*)?)"',
    r'"(https?://[^\s"\'<>]+\.mp3(?:[?#][^\s"\'<>]*)?)"',
    r"'(https?://[^\s\"'<>]+\.m3u8(?:[?#][^\s\"'<>]*)?)'",
    r"'(https?://[^\s\"'<>]+\.mp4(?:[?#][^\s\"'<>]*)?)'",
    r"'(https?://[^\s\"'<>]+\.mp3(?:[?#][^\s\"'<>]*)?)'",

    # JW Player:  file: "...",  sources: [{file:"..."}]
    r"[\"']?file[\"']\s*:\s*[\"']([^\"']+(?:\.m3u8|\.mp4|\.mp3)[^\"']*)[\"']",

    # VideoJS / generic:  src: "..."
    r"[\"']?src[\"']\s*:\s*[\"']([^\"']+(?:\.m3u8|\.mp4|\.mp3)[^\"']*)[\"']",

    # Generic key=value or key: value — covers many custom players
    r"[\"']?(?:source|stream|hls|hlsUrl|streamUrl|videoUrl|liveUrl|playUrl|hlsSrc|m3u8|url)"
    r"[\"']\s*[=:]\s*[\"']([^\"']+(?:\.m3u8|\.mp4|\.mp3)[^\"']*)[\"']",

    # Flowplayer / Plyr object notation
    r"src\s*:\s*[\"']([^\"']+(?:\.m3u8|\.mp4|\.mp3)[^\"']*)[\"']",

    # type: application/x-mpegURL with nearby src
    r"application/x-mpegURL[^}]{0,200}?src\s*:\s*[\"']([^\"']+)[\"']",

    # Unquoted CDN stream hostnames (common in minified JS)
    r'(https?://[a-z0-9.\-]+(?:akamai|cdn|stream|live|hls|edge|media)[^\s"\'<>&]{10,})',
]

# Regex to find parsatv PHP fetch endpoint inside page scripts
# e.g. fetch('/streams/fetch/asg/sh3.php') or $.get('/streams/fetch/irib/sh3.php', ...)
PHP_FETCH_PATTERN = re.compile(
    r"""['"](/streams/fetch/[^\s'"]+\.php)['"]""",
    re.IGNORECASE,
)


def _search_scripts_for_stream(soup: BeautifulSoup) -> str | None:
    """Search all <script> blocks in the page for a recognisable stream URL."""
    for script in soup.find_all("script"):
        text = script.string or ""
        if not text.strip():
            continue
        for pattern in JS_STREAM_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                url = match.group(1)
                if url.startswith("http") and len(url) > 15:
                    return url
    return None


def _find_php_fetch_endpoints(soup: BeautifulSoup) -> list[str]:
    """
    Find parsatv's hidden PHP stream-fetch endpoints embedded in script tags.
    Returns a list of full URLs e.g. ['https://www.parsatv.com/streams/fetch/asg/sh3.php']
    """
    endpoints = []
    for script in soup.find_all("script"):
        text = script.string or ""
        if not text.strip():
            continue
        for match in PHP_FETCH_PATTERN.finditer(text):
            path = match.group(1)
            full_url = urljoin(BASE_URL, path)
            if full_url not in endpoints:
                endpoints.append(full_url)
    return endpoints


def _fetch_stream_from_php(
    php_url: str, page_url: str, session: requests.Session
) -> str | None:
    """
    Call a parsatv PHP stream-fetch endpoint with the correct Referer header.
    The response contains the player config (JSON or JS) with the .m3u8 URL.
    Returns the stream URL string or None.
    """
    headers = {
        "Referer": page_url,
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
    }
    print(f"  [php] Fetching: {php_url}")
    raw = get_raw(php_url, session, extra_headers=headers)
    if not raw:
        return None

    # Try to parse as JSON first
    try:
        data = json.loads(raw)
        # Common patterns in ther response
        for key in ("file", "url", "src", "stream", "hls", "source", "link"):
            val = data.get(key, "")
            if val and (".m3u8" in val or ".mp4" in val or ".mp3" in val):
                return val
        # Sometimes it's nested: sources: [{file: "..."}]
        sources = data.get("sources") or data.get("playlist") or []
        if isinstance(sources, list):
            for src in sources:
                if isinstance(src, dict):
                    for key in ("file", "src", "url"):
                        val = src.get(key, "")
                        if val and (".m3u8" in val or ".mp4" in val or ".mp3" in val):
                            return val
    except (json.JSONDecodeError, AttributeError):
        pass

    # Fall back: regex over raw response text
    for pattern in JS_STREAM_PATTERNS:
        m = re.search(pattern, raw, re.IGNORECASE)
        if m:
            url = m.group(1)
            if url.startswith("http") and len(url) > 15:
                return url

    return None


# ─────────────────────────────────────────────────────────────
# Main extraction entry point
# ─────────────────────────────────────────────────────────────

def extract_stream_url(
    soup: BeautifulSoup, page_url: str, session: requests.Session | None = None
) -> str | None:
    """
    Try to extract a stream URL from a channel page.
    Search order:
      0. Parsatv PHP stream-fetch endpoint (highest quality source)
      1. <source src="..."> and <video src="...">
      2. VideoJS data-setup JSON attribute
      3. All <script> block text (JW Player, VideoJS, Flowplayer, Plyr, raw vars)
      4. data-* attributes anywhere on the page
      5. <iframe> — follow and repeat steps 0-3 on the iframe source page
    """
    # 0. Parsatv-specific: look for hidden PHP fetch endpoints in JS
    if session is not None:
        php_endpoints = _find_php_fetch_endpoints(soup)
        for php_url in php_endpoints:
            stream = _fetch_stream_from_php(php_url, page_url, session)
            if stream:
                print(f"  [php] ✓ Found stream via PHP endpoint: {stream[:70]}")
                return stream

    # 1. HTML <source>, <video>, and <audio> tags
    for tag in soup.find_all(["source", "video", "audio"]):
        for attr in ("src", "data-src"):
            src = tag.get(attr, "")
            if src and (".m3u8" in src or ".mp4" in src or ".mp3" in src):
                return src

    # 1.5 Check Schema.org JSON-LD for AudioObject/VideoObject
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string)
            if isinstance(data, dict):
                contentUrl = data.get("contentUrl")
                if contentUrl and str(contentUrl).startswith("http"):
                    if (".m3u8" in contentUrl or ".mp4" in contentUrl or ".mp3" in contentUrl) or \
                       (data.get("@type") in ("AudioObject", "VideoObject")):
                        return contentUrl
        except Exception:
            pass

    # 2. VideoJS data-setup JSON attribute
    for el in soup.find_all(attrs={"data-setup": True}):
        setup_text = el["data-setup"]
        for pattern in JS_STREAM_PATTERNS:
            m = re.search(pattern, setup_text, re.IGNORECASE)
            if m:
                url = m.group(1)
                if url.startswith("http"):
                    return url

    # 3. Search all <script> blocks
    found = _search_scripts_for_stream(soup)
    if found:
        return found

    # 4. data-* attributes anywhere that look like stream URLs
    for el in soup.find_all(True):
        for attr, val in el.attrs.items():
            if not isinstance(val, str):
                continue
            if attr.startswith("data-") and (".m3u8" in val or ".mp4" in val or ".mp3" in val):
                if val.startswith("http"):
                    return val

    # 5. Follow iframes — fetch their source and repeat the search
    if session is not None:
        for iframe in soup.find_all("iframe"):
            src = iframe.get("src", "").strip()
            if not src or src.startswith("javascript"):
                continue
            # Resolve protocol-relative and relative URLs
            if src.startswith("//"):
                src = "https:" + src
            elif not src.startswith("http"):
                src = urljoin(page_url, src)

            if "telewebion" in src and "/live/" in src:
                match = re.search(r'/live/([^/?#]+)', src)
                if match:
                    alias = match.group(1)
                    fallback_url = f"https://cdnw.telewebion.com/{alias}/live/playlist.m3u8"
                    print(f"  [telewebion] Returning known CDN pattern: {fallback_url}")
                    return fallback_url

            print(f"  [iframe] Following: {src[:80]}")
            try:
                iframe_headers = {"Referer": page_url}
                iframe_soup = get_page(
                    src,
                    session,
                    extra_headers=iframe_headers,
                    timeout=(FOLLOW_CONNECT_TIMEOUT_S, FOLLOW_READ_TIMEOUT_S),
                )
                if iframe_soup:
                    # Try PHP endpoints inside the iframe too
                    php_endpoints = _find_php_fetch_endpoints(iframe_soup)
                    for php_url in php_endpoints:
                        stream = _fetch_stream_from_php(php_url, src, session)
                        if stream:
                            return stream
                    for tag in iframe_soup.find_all(["source", "video", "audio"]):
                        for attr in ("src", "data-src"):
                            sv = tag.get(attr, "")
                            if sv and (".m3u8" in sv or ".mp4" in sv or ".mp3" in sv):
                                return sv
                    result = _search_scripts_for_stream(iframe_soup)
                    if result:
                        return result
            except Exception:
                pass

    return None


def scrape_channel_page(url: str, session: requests.Session) -> str | None:
    """Visit a channel page and return its stream URL."""
    extra = {"Referer": BASE_URL}
    soup = get_page(url, session, extra_headers=extra)
    if not soup:
        return None
    return extract_stream_url(soup, url, session=session)


# ─────────────────────────────────────────────────────────────
# Homepage scraping
# ─────────────────────────────────────────────────────────────

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
    category_sections = soup.find_all(
        ["section", "div", "ul"],
        class_=re.compile(r"categor|channel|list|grid|group|section", re.IGNORECASE),
    )

    for section in category_sections:
        heading = section.find(["h1", "h2", "h3", "h4", "h5", "li", "span", "a"])
        category = heading.get_text(strip=True) if heading else "General"
        if len(category) > 50:
            category = "General"

        links = section.find_all("a", href=True)
        for link in links:
            href = link.get("href", "")
            if not href or href == "#":
                continue

            full_url = urljoin(BASE_URL, href)
            if full_url in seen_urls:
                continue

            if "parsatv.com" not in full_url:
                continue

            name = link.get_text(strip=True)
            if not name:
                img = link.find("img")
                if img:
                    name = img.get("alt", "").strip() or img.get("title", "").strip()
            if not name or len(name) < 2:
                continue

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


# ─────────────────────────────────────────────────────────────
# Build output JSON
# ─────────────────────────────────────────────────────────────

def build_channels_json(raw_channels: list[dict], session: requests.Session) -> dict:
    """
    Visit each channel page to get stream URLs, then build final JSON.
    Capped at MAX_CHANNELS entries if set.
    """
    if MAX_CHANNELS is not None:
        raw_channels = raw_channels[:MAX_CHANNELS]
        print(f"[*] Capped to first {MAX_CHANNELS} channels (MAX_CHANNELS setting).")

    result_channels = []
    total = len(raw_channels)
    existing_by_id = {}
    try:
        with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
            old_data = json.load(f)
            for old_ch in old_data.get("channels", []):
                old_id = old_ch.get("id")
                if old_id:
                    existing_by_id[old_id] = old_ch
    except Exception:
        pass

    for i, ch in enumerate(raw_channels, 1):
        name = ch["name"]
        page_url = ch["page_url"]
        category = ch.get("category", "General")
        channel_id = slugify(name)

        print(f"[{i}/{total}] Processing: {name}")
        print(f"         URL: {page_url}")
        stream_url = scrape_channel_page(page_url, session)
        if not stream_url:
            previous = existing_by_id.get(channel_id, {})
            previous_stream = previous.get("stream_url")
            if previous_stream:
                stream_url = previous_stream
                print("  [fallback] Using previous stream_url from channels.json")

        status = f"  ✓ stream: {stream_url[:70]}" if stream_url else "  ✗ no stream found"
        print(status)

        result_channels.append(
            {
                "id": channel_id,
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

    found_count = sum(1 for c in result_channels if c["stream_url"])
    print(f"\n[*] Stream URLs found: {found_count}/{total}")

    return {
        "scraped_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total": len(result_channels),
        "channels": result_channels,
    }


def main():
    print("=" * 60)
    print("ParsaTV Channel Scraper")
    print("=" * 60)

    with configure_session(requests.Session()) as session:
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
