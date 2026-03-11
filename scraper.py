#!/usr/bin/env python3
"""
parsatv.com Channel Scraper
Extracts all TV channel data including stream URLs from parsatv.com
"""

import requests
from bs4 import BeautifulSoup
import json
import re
import time
import logging
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse, quote
import sys

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
log = logging.getLogger(__name__)

BASE_URL = "https://www.parsatv.com"
OUTPUT_FILE = "channels.json"
REQUEST_DELAY = 1.0  # seconds between requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,fa;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}

# Language inference from category
CATEGORY_LANGUAGE_MAP = {
    "persian":   "fa",
    "farsi":     "fa",
    "iran":      "fa",
    "news":      "fa",
    "music":     "fa",
    "sport":     "fa",
    "sports":    "fa",
    "movie":     "fa",
    "film":      "fa",
    "kids":      "fa",
    "children":  "fa",
    "arabic":    "ar",
    "arab":      "ar",
    "english":   "en",
    "turkish":   "tr",
    "turkish":   "tr",
    "french":    "fr",
    "german":    "de",
    "spanish":   "es",
    "kurdish":   "ku",
    "kurd":      "ku",
    "afghan":    "fa",
    "tajik":     "tg",
}


def slugify(text: str) -> str:
    """Convert channel name to a URL-friendly slug."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


def infer_language(category: str) -> str:
    """Infer language code from category name."""
    cat_lower = category.lower()
    for keyword, lang in CATEGORY_LANGUAGE_MAP.items():
        if keyword in cat_lower:
            return lang
    return "fa"  # Default to Farsi for parsatv.com


def get_page(url: str, session: requests.Session, timeout: int = 15) -> BeautifulSoup | None:
    """Fetch a page and return a BeautifulSoup object, or None on failure."""
    try:
        response = session.get(url, headers=HEADERS, timeout=timeout)
        response.raise_for_status()
        return BeautifulSoup(response.text, "html.parser")
    except requests.RequestException as e:
        log.warning(f"Failed to fetch {url}: {e}")
        return None


def extract_stream_url(soup: BeautifulSoup, page_url: str, session: requests.Session) -> str | None:
    """
    Try multiple strategies to find the stream URL in a channel page.
    Returns the first .m3u8 / .mp4 URL found, or None.
    """
    html_text = str(soup)

    # Strategy 1: Look for .m3u8 URLs directly in page source
    m3u8_matches = re.findall(
        r'https?://[^\s\'"<>]+\.m3u8[^\s\'"<>]*',
        html_text
    )
    if m3u8_matches:
        return m3u8_matches[0].strip()

    # Strategy 2: Look for .mp4 URLs
    mp4_matches = re.findall(
        r'https?://[^\s\'"<>]+\.mp4[^\s\'"<>]*',
        html_text
    )
    if mp4_matches:
        return mp4_matches[0].strip()

    # Strategy 3: Look for rtmp/rtsp URLs
    rtmp_matches = re.findall(
        r'rtm[ps]?://[^\s\'"<>]+',
        html_text
    )
    if rtmp_matches:
        return rtmp_matches[0].strip()

    # Strategy 4: Look for video source tags
    for source in soup.find_all("source"):
        src = source.get("src", "")
        if src and ("m3u8" in src or "mp4" in src or src.startswith("rtmp")):
            return urljoin(page_url, src)

    # Strategy 5: Look for video tag src
    for video in soup.find_all("video"):
        src = video.get("src", "")
        if src:
            return urljoin(page_url, src)

    # Strategy 6: Check iframes — visit iframe src and recurse once
    for iframe in soup.find_all("iframe"):
        iframe_src = iframe.get("src", "")
        if not iframe_src:
            continue
        iframe_url = urljoin(page_url, iframe_src)
        # Only follow iframes on the same domain or known video domains
        parsed = urlparse(iframe_url)
        if parsed.scheme in ("http", "https"):
            log.debug(f"  Following iframe: {iframe_url}")
            time.sleep(0.5)
            iframe_soup = get_page(iframe_url, session)
            if iframe_soup:
                iframe_html = str(iframe_soup)
                m3u8 = re.findall(r'https?://[^\s\'"<>]+\.m3u8[^\s\'"<>]*', iframe_html)
                if m3u8:
                    return m3u8[0].strip()
                mp4 = re.findall(r'https?://[^\s\'"<>]+\.mp4[^\s\'"<>]*', iframe_html)
                if mp4:
                    return mp4[0].strip()

    # Strategy 7: Look for JSON/JS config with stream key patterns
    stream_patterns = [
        r'"(?:file|src|source|url|stream|hls|hlsUrl|streamUrl)"\s*:\s*"(https?://[^"]+)"',
        r"'(?:file|src|source|url|stream|hls|hlsUrl|streamUrl)'\s*:\s*'(https?://[^']+)'",
        r'(?:file|src|source|url|stream|hls):\s*["\']?(https?://[^\s"\'<>,\]]+)',
    ]
    for pattern in stream_patterns:
        matches = re.findall(pattern, html_text, re.IGNORECASE)
        for m in matches:
            if "m3u8" in m or "mp4" in m or "stream" in m.lower():
                return m.strip()

    return None


def extract_logo_url(soup: BeautifulSoup, page_url: str) -> str | None:
    """Try to find the channel logo image URL."""
    # Look for og:image meta tag first
    og_image = soup.find("meta", property="og:image")
    if og_image:
        content = og_image.get("content", "")
        if content:
            return content

    # Look for channel-specific logo patterns
    for img in soup.find_all("img"):
        src = img.get("src", "")
        alt = (img.get("alt", "") or "").lower()
        classes = " ".join(img.get("class", [])).lower()
        if any(k in classes for k in ["logo", "channel", "thumb"]):
            if src:
                return urljoin(page_url, src)
        if any(k in alt for k in ["logo", "channel"]):
            if src:
                return urljoin(page_url, src)

    # Fallback: first meaningful image
    for img in soup.find_all("img"):
        src = img.get("src", "")
        if src and not src.endswith(".gif") and "banner" not in src.lower():
            width = img.get("width")
            height = img.get("height")
            # Skip tiny images (likely icons/spacers)
            if width and int(width) < 20:
                continue
            return urljoin(page_url, src)

    return None


def parse_homepage(soup: BeautifulSoup) -> list[dict]:
    """
    Parse the parsatv.com homepage and return a list of
    {name, category, subcategory, page_url, logo_url} dicts.
    """
    channels = []
    seen_urls = set()

    # Try to find channel groupings — look for section/div with category headings
    # parsatv.com uses category sections like "Persian", "News", etc.
    category_sections = []

    # Common patterns: h2/h3 heading followed by channel links
    for heading_tag in ["h1", "h2", "h3", "h4"]:
        headings = soup.find_all(heading_tag)
        for heading in headings:
            category_name = heading.get_text(strip=True)
            if not category_name or len(category_name) > 60:
                continue
            # Find the next sibling container with channel links
            sibling = heading.find_next_sibling()
            if sibling:
                category_sections.append((category_name, sibling))

    # Also look for nav/menu structures
    for nav in soup.find_all(["nav", "ul"], class_=re.compile(r"channel|menu|list|cat", re.I)):
        category_sections.append(("General", nav))

    # Process each section
    for category_name, container in category_sections:
        for a_tag in container.find_all("a", href=True):
            href = a_tag["href"]
            if not href or href == "#":
                continue
            full_url = urljoin(BASE_URL, href)
            if full_url in seen_urls:
                continue
            # Filter: only channel-looking URLs
            if "parsatv.com" not in full_url:
                continue
            if any(skip in full_url.lower() for skip in ["facebook", "twitter", "instagram", "youtube", "mailto", "javascript"]):
                continue

            seen_urls.add(full_url)
            name = a_tag.get_text(strip=True) or a_tag.get("title", "")
            if not name:
                img = a_tag.find("img")
                if img:
                    name = img.get("alt", "") or img.get("title", "")
            if not name:
                continue

            logo = None
            img_tag = a_tag.find("img")
            if img_tag:
                logo_src = img_tag.get("src", "")
                if logo_src:
                    logo = urljoin(BASE_URL, logo_src)

            channels.append({
                "name": name,
                "category": category_name,
                "subcategory": "",
                "page_url": full_url,
                "logo_url": logo,
            })

    # Fallback: if nothing found via sections, scan all channel links on page
    if not channels:
        log.info("No category sections found, falling back to flat link scan")
        for a_tag in soup.find_all("a", href=True):
            href = a_tag["href"]
            full_url = urljoin(BASE_URL, href)
            if full_url in seen_urls:
                continue
            if "parsatv.com" not in full_url:
                continue
            # parsatv uses ?name= or /name= style URLs for channels
            if "name=" not in href and "/channel/" not in href.lower():
                continue

            seen_urls.add(full_url)
            name = a_tag.get_text(strip=True)
            if not name:
                img = a_tag.find("img")
                if img:
                    name = img.get("alt", "")
            if not name:
                continue

            logo = None
            img_tag = a_tag.find("img")
            if img_tag:
                logo_src = img_tag.get("src", "")
                if logo_src:
                    logo = urljoin(BASE_URL, logo_src)

            channels.append({
                "name": name,
                "category": "General",
                "subcategory": "",
                "page_url": full_url,
                "logo_url": logo,
            })

    log.info(f"Found {len(channels)} channel links on homepage")
    return channels


def scrape_channel(channel_info: dict, session: requests.Session) -> dict:
    """Visit a channel page and enrich with stream_url, updated logo, language."""
    page_url = channel_info["page_url"]
    log.info(f"  Scraping: {channel_info['name']} — {page_url}")

    soup = get_page(page_url, session)
    stream_url = None
    logo_url = channel_info.get("logo_url")

    if soup:
        stream_url = extract_stream_url(soup, page_url, session)
        if not logo_url:
            logo_url = extract_logo_url(soup, page_url)

        if stream_url:
            log.info(f"    Found stream: {stream_url[:80]}...")
        else:
            log.warning(f"    No stream URL found for: {channel_info['name']}")
    else:
        log.warning(f"    Could not fetch page for: {channel_info['name']}")

    language = infer_language(channel_info["category"])

    return {
        "id": slugify(channel_info["name"]),
        "name": channel_info["name"],
        "category": channel_info["category"],
        "subcategory": channel_info.get("subcategory", ""),
        "language": language,
        "logo_url": logo_url,
        "stream_url": stream_url,
        "page_url": page_url,
        "working": None,
    }


def main():
    log.info("Starting parsatv.com scraper...")
    session = requests.Session()
    session.headers.update(HEADERS)

    # Step 1: Fetch homepage
    log.info(f"Fetching homepage: {BASE_URL}")
    homepage_soup = get_page(BASE_URL, session)
    if not homepage_soup:
        log.error("Failed to fetch homepage. Exiting.")
        sys.exit(1)

    # Step 2: Parse channel links
    channel_list = parse_homepage(homepage_soup)
    if not channel_list:
        log.error("No channels found on homepage. The site structure may have changed.")
        sys.exit(1)

    # Step 3: Scrape each channel page
    scraped_channels = []
    for i, channel_info in enumerate(channel_list, 1):
        log.info(f"[{i}/{len(channel_list)}] Processing {channel_info['name']}")
        channel_data = scrape_channel(channel_info, session)
        scraped_channels.append(channel_data)
        time.sleep(REQUEST_DELAY)

    # Step 4: Save results
    output = {
        "scraped_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total": len(scraped_channels),
        "channels": scraped_channels,
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    found_streams = sum(1 for c in scraped_channels if c["stream_url"])
    log.info(f"\nDone! Scraped {len(scraped_channels)} channels, {found_streams} with stream URLs.")
    log.info(f"Results saved to: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
