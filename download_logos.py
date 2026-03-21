#!/usr/bin/env python3
import json
import os
import sys
import time
import requests

try:
    from urllib.parse import urlparse
except ImportError:
    pass

API_KEY = os.environ.get("SERPER_API_KEY")
CHANNELS_FILE = "channels.json"
IMG_DIR = "img"

def get_extension(url, headers):
    """Attempt to guess the image extension based on headers or original URL."""
    ct = headers.get("content-type", "")
    if "image/png" in ct:
        return ".png"
    elif "image/webp" in ct:
        return ".webp"
    elif "image/gif" in ct:
        return ".gif"
    elif "image/jpeg" in ct or "image/jpg" in ct:
        return ".jpg"
    
    # Fallback to URL path inspection
    path = urlparse(url).path
    ext = os.path.splitext(path)[1].lower()
    if ext in [".png", ".jpg", ".jpeg", ".webp", ".gif"]:
        return ext
    return ".jpg"  # Default fallback

def download_image(name, ch_id):
    """Use Serper API to find a logo, check locally first to save API hits, and download it."""
    # 1. Check if we already have this image downloaded locally
    for ext in [".png", ".jpg", ".jpeg", ".webp", ".gif"]:
        if os.path.exists(os.path.join(IMG_DIR, f"{ch_id}{ext}")):
            print(f"  [✓] Image already exists locally for '{name}' ({ch_id}{ext})")
            return f"{IMG_DIR}/{ch_id}{ext}"

    if not API_KEY:
        print(f"  [!] SERPER_API_KEY environment variable not set. Skipping remote download for '{name}'.")
        return None

    print(f"  [*] Searching HD transparent logo remotely for: '{name}'")
    try:
        url = "https://google.serper.dev/images"
        payload = json.dumps({
          "q": f"{name} television channel logo",
          "tbs": "ic:trans,isz:l"
        })
        headers = {
          'X-API-KEY': API_KEY,
          'Content-Type': 'application/json'
        }
        
        # Call Serper.dev
        response = requests.request("POST", url, headers=headers, data=payload, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        images = data.get("images", [])
        if not images:
            print(f"  [!] No images found on Serper for '{name}'.")
            return None
            
        # Get the first highly relevant image URL
        img_url = images[0]["imageUrl"]
        print(f"  [*] Downloading from: {img_url[:70]}...")
        
        # Download the actual image bytes securely with a respectful User-Agent
        img_resp = requests.get(img_url, timeout=15, headers={"User-Agent": "MasTV_LogoFetcher/1.0 (contact@mastv.app)"})
        img_resp.raise_for_status()
        
        # Determine strict extension and save
        ext = get_extension(img_url, img_resp.headers)
        filename = f"{ch_id}{ext}"
        filepath = os.path.join(IMG_DIR, filename)
        
        with open(filepath, "wb") as f:
            f.write(img_resp.content)
            
        print(f"  [✓] Successfully saved logo to {filepath}")
        return f"{IMG_DIR}/{filename}"

    except Exception as e:
        print(f"  [!] Error downloading logo for '{name}': {e}")
        return None

def main():
    if not os.path.exists(CHANNELS_FILE):
        print(f"Error: {CHANNELS_FILE} not found.")
        sys.exit(1)
        
    # Ensure the img directory exists
    os.makedirs(IMG_DIR, exist_ok=True)
        
    with open(CHANNELS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    channels = data.get("channels", [])
    print(f"Loaded {len(channels)} channels. Checking for missing logos...")
    
    updated_count = 0
    
    for ch in channels:
        # Check if the channel already has a valid mapped relative local image path
        existing_logo = ch.get("logo_url")
        if existing_logo and existing_logo.startswith(f"{IMG_DIR}/") and os.path.exists(existing_logo):
            continue
            
        # Download new logo or recover existing one that isn't cleanly mapped in JSON
        new_logo_path = download_image(ch["name"], ch["id"])
        
        if new_logo_path and new_logo_path != existing_logo:
            ch["logo_url"] = new_logo_path
            updated_count += 1
            
        time.sleep(0.5)  # 500ms buffer to respect Wikipedia/external rate limits
            
    if updated_count > 0:
        data["channels"] = channels
        with open(CHANNELS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"\nCompleted! Downloaded and mapped {updated_count} new logos to channels.json.")
    else:
        print("\nAll channels already have an assigned local logo, or no new logos were successfully downloaded.")

if __name__ == "__main__":
    main()
