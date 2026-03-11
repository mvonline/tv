# Iranian TV Channel App for Titan OS (Philips TV) — Full Build

## Project Overview
Build two things:
1. A scraper script to extract all TV channel data from http://parsatv.com/
2. A hosted HTML5 web app for Titan OS (Philips Smart TV) that streams those channels
   with a polished TV-optimized UI controlled entirely by D-pad remote.

Titan OS runs on a Linux-based Chromium browser — NO Android, NO APK.
The app is a hosted web page pointed to by the Titan OS app store.

---

## PART 1 — Scraper Script

### Goal
Scrape http://parsatv.com/ and all individual channel pages to extract stream URLs
and metadata, then save to a structured JSON file.

### Tech
- Language: Python 3
- Libraries: requests, BeautifulSoup4, selenium (if JS rendering needed), json, re
- Use a browser User-Agent header to avoid blocks

### What to Extract (per channel)
For each channel found on parsatv.com, extract:
- id: slugified version of name (e.g. "manoto-tv")
- name: display name (e.g. "Manoto TV")
- category: the section it belongs to (e.g. "Persian", "News", "Music", "Sport", etc.)
- logo_url: channel logo image URL
- stream_url: the HLS (.m3u8) or direct stream URL
  → Find this by inspecting the embedded player on each channel page
  → Look for .m3u8, .mp4, or iframe src in the page source or network requests
- page_url: the original parsatv.com channel page URL
- language: inferred from category (e.g. "fa", "en", "ar", "de", "ku")

### Scraper Behavior
- Start from the homepage: parse all channel links grouped by category
- For each channel link (e.g. https://www.parsatv.com/name=Manoto-TV), 
  visit the page and extract the stream URL from the video player source
- Handle failures gracefully: if stream URL not found, set stream_url to null
  and continue
- Add a 1-second delay between requests to be polite
- Save results to: channels.json

### Output JSON Format
{
  "scraped_at": "2025-01-01T00:00:00Z",
  "total": 150,
  "channels": [
    {
      "id": "manoto-tv",
      "name": "Manoto TV",
      "category": "Persian",
      "subcategory": "General",
      "language": "fa",
      "logo_url": "https://...",
      "stream_url": "https://....m3u8",
      "page_url": "https://www.parsatv.com/name=Manoto-TV",
      "working": null
    }
  ]
}

### Bonus
- Add a second script: stream_checker.py that loops through channels.json,
  sends a HEAD request to each stream_url, and sets working: true/false
  Then saves updated channels.json

---

## PART 2 — Titan OS HTML5 TV App

### Goal
A fully hosted single-page HTML5 app that:
- Loads channels from channels.json (same domain or CDN)
- Displays them in a beautiful TV-optimized UI
- Is navigated entirely with D-pad remote (arrow keys + Enter + Back)
- Streams HLS video using hls.js

### Platform Constraints
- Runs in Chromium on Linux (Titan OS / Philips TV)
- No mouse, no touch — keyboard/remote ONLY
- Resolution: 1920x1080 (Full HD)
- Must be a single hosted URL
- Use hls.js from CDN for HLS stream support

### App Structure: 3 Screens

#### Screen 1 — Home / Channel Browser
Layout:
- Left sidebar (20% width): category list (All, Persian, News, Music, Sport, etc.)
  → Navigable with Up/Down arrows
  → Selected category highlights in accent color
- Main area (80% width): channel cards grid (4-5 columns)
  → Each card shows: channel logo, name, category badge
  → Focused card scales up slightly (CSS transform) with a glowing border
- Top bar: App name/logo, search icon, current time clock

Navigation behavior:
- Arrow keys move focus between cards and sidebar
- Enter on a card → opens Player Screen
- Enter on search icon → opens Search Screen
- Left arrow from grid → moves focus to sidebar

#### Screen 2 — Player / Watch Screen
Layout:
- Fullscreen video (black background)
- Overlay HUD (fades out after 3 seconds of inactivity):
  → Top left: channel logo + name
  → Bottom: progress/live indicator, buffering spinner
  → Bottom right: current time
- Pressing Back → returns to Home screen, stops stream

Player behavior:
- Use hls.js to load and play the stream_url
- Show loading spinner while buffering
- Show "Stream unavailable" message with Back prompt if stream fails
- Auto-hide overlay after 3s, show again on any key press

#### Screen 3 — Search Screen
Layout:
- Full screen overlay (dark, semi-transparent)
- Top: on-screen keyboard OR filter-as-you-type using remote
  (preferred: instant text filter using a hidden <input> that receives
  key events, no on-screen keyboard needed)
- Results: same card grid as Home, filtered in real time
- Esc or Back → returns to Home

### Filtering & Sorting
In the Home screen sidebar, include:
- Category filters (All + each unique category from JSON)
- Sort options: A→Z, Z→A, By Category
These should be navigable with arrow keys and selectable with Enter.

### Visual Design
- Dark theme: background #0d0d0d, cards #1a1a1a, focus color #e5a00d (warm gold)
- Typography: clean sans-serif (Inter or system font), large enough for 10-foot viewing
  → Channel names: 18-20px, Category labels: 14px
- Card size: ~280x160px with logo centered, name below
- Focused element: gold border + subtle box-shadow glow + scale(1.07)
- Smooth CSS transitions on all focus changes (0.15s ease)
- Category sidebar active item: left gold border accent
- Loading state: skeleton shimmer cards while channels.json is fetching

### D-pad / Remote Key Mapping
Handle these keydown events:
- ArrowUp, ArrowDown, ArrowLeft, ArrowRight → move focus
- Enter (keyCode 13) → select / activate
- Backspace or Escape (or keyCode 10009 for Samsung/Tizen Back,
  keyCode 461 for LG webOS Back) → go back / close overlay
- Also handle Titan OS / Philips remote back button keyCodes if documented

### channels.json Loading
- Fetch channels.json on app load
- Show loading skeleton during fetch
- If fetch fails, show friendly error screen with retry button (focusable)
- Filter out channels where stream_url is null or working is false

### File Structure
/
├── index.html        (single file app, all CSS+JS inline or in same folder)
├── app.js            (main app logic)
├── style.css         (all styles)
├── channels.json     (generated by scraper)
└── assets/
    └── logo.svg      (app logo)

### Code Requirements
- Vanilla JS only (no React/Vue/Angular) — keep it lightweight for TV browser
- No build tools required — must work by just opening index.html from a server
- Accessible focus management: always one element focused, never lose focus
- channels.json path should be configurable at top of app.js as a constant:
  const CHANNELS_URL = './channels.json';
- Add a CONFIG object at top of app.js:
  const CONFIG = {
    channelsUrl: './channels.json',
    focusColor: '#e5a00d',
    overlayHideDelay: 3000,
    columns: 5,
  };

---

## Deliverables
1. scraper.py — full scraper with error handling
2. stream_checker.py — stream URL validator
3. index.html — TV app entry point
4. app.js — full app logic
5. style.css — all TV-optimized styles
6. README.md — setup instructions:
   - How to run the scraper
   - How to host the app (e.g. on Vercel/Netlify)
   - How to submit the hosted URL to Titan OS Partner Portal