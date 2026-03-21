"""
scrape_url.py — Single URL scraper for ParsaTV
Reuses the extraction logic from scraper.py to find a stream URL for a given page.

Usage:
    python scrape_url.py <URL or slug>
    Example: python scrape_url.py https://www.parsatv.com/name=Manoto-TV
    Example: python scrape_url.py name=Manoto-TV
"""

import sys
import requests
from urllib.parse import urljoin
from scraper import scrape_channel_page, BASE_URL

def main():
    if len(sys.argv) < 2:
        print("Usage: python scrape_url.py <URL or slug>")
        print("Example: python scrape_url.py https://www.parsatv.com/name=Manoto-TV")
        print("Example: python scrape_url.py name=Manoto-TV")
        sys.exit(1)

    input_val = sys.argv[1].strip()
    
    # If it doesn't look like a URL, assume it's a relative path or slug
    if not input_val.startswith("http"):
        if input_val.startswith("name=") or input_val.startswith("/"):
            url = urljoin(BASE_URL, input_val)
        else:
            url = urljoin(BASE_URL, f"name={input_val}")
    else:
        url = input_val

    print(f"[*] Target URL: {url}")
    print(f"[*] Scraping...")

    with requests.Session() as session:
        stream_url = scrape_channel_page(url, session)

    if stream_url:
        print(f"\n[✓] Found stream URL:")
        print(stream_url)
    else:
        print("\n[✗] No stream URL found for this page.")
        sys.exit(1)

if __name__ == "__main__":
    main()
