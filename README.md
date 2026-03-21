# MasTV — Iranian Channels for Titan OS (Philips TV)

A hosted HTML5 TV app for watching Iranian TV channels on Titan OS / Philips Smart TV,
powered by a Python scraper that pulls live channel data from parsatv.com.

---

## Quick Start

### 1. Install `uv` (fast Python toolchain)

```bash
# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
```

> Restart your terminal after installation so `uv` is on your PATH.

---

### 2. Create a virtual environment & install dependencies

```bash
# From the project root directory
uv venv

# Activate the venv
# Windows:
.venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate

# Install Python dependencies
uv pip install -r requirements.txt
```

---

### 3. Run the scraper

```bash
python scraper.py
```

This scrapes parsatv.com and writes `channels.json` to the project root.

---

### 4. (Optional) Validate stream URLs

```bash
python stream_checker.py
```

Sends HEAD requests to each stream URL and marks `working: true/false`.
The TV app automatically skips channels with `working: false` or no stream URL.

---

### 5. Categorize Channels (AI-Powered)

```bash
# Configure your Gemini API key (Optional, but highly recommended)
# Windows (PowerShell):
$env:GEMINI_API_KEY="your-free-api-key"
# macOS / Linux:
export GEMINI_API_KEY="your-free-api-key"

python smart_categorizer.py
```

This offline utility normalizes the raw channel categories into clean, standardized master themes (Sports, News, Music, Movies, Kids, etc). It uses a lightning-fast local rule engine to instantly map known channels, and seamlessly falls back to the **Google Gemini API** (if an API key is provided) to intelligently categorize the remaining complex channels.

---

### 6. Test a Single Channel URL

```bash
python scrape_url.py "https://www.parsatv.com/name=Radio-Yar#radio"
```

A standalone debugging utility that runs the core extraction logic against a single ParsaTV URL and prints the raw underlying stream. Extremely useful for verifying extraction fixes or extracting audio streams directly without scraping the entire site.

## Cross-Platform Builds (Windows, macOS, Linux, iOS, Android)

This app is configured with **Tauri v2** to build native applications for 7 platforms from the same HTML5 codebase. 

Because building for iOS requires a Mac (Xcode), and building Tauri requires Rust, this repository includes an automated **GitHub Actions CI/CD pipeline** that handles everything in the cloud for you.

### How to create a Release (and trigger Cloud Builds):
1. **Push a Tag**: When you are ready to create a version (e.g., v1.0.0), run:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. **Auto-Build**: GitHub Actions will automatically start building **Windows, macOS, Linux, iOS, and Android** versions.
3. **Download**: Once finished, a **GitHub Release** will be created in your repository.
4. **Changelog**: A changelog will be automatically generated and attached to the release description.

To trigger a standard build without creating a release, just push to the `main` branch as usual.

---

## Production Store Submission (App Store & Play Store)

The GitHub Actions workflow includes a **Production Release** job that is triggered only on the `main` branch. This job features a **Manual Approval Gate**.

### 1. Setup GitHub Environment
1. Go to your GitHub Repository Settings → **Environments**.
2. Click **New environment** and name it `Production`.
3. Check **Required reviewers** and add yourself. This ensures the app is NOT pushed to stores until you click "Approve" in the Actions UI.

### 2. Required Secrets
Add the following secrets to your GitHub Repository (Settings → Secrets and variables → Actions):
- `APPLE_ID`: Your Apple ID email.
- `APPLE_APP_SPECIFIC_PASSWORD`: Generated from appleid.apple.com.
- `ANDROID_SERVICE_ACCOUNT_JSON`: The JSON key for your Google Play Console service account.

---

## Local Web Development

If you just want to edit the HTML/JS/CSS without building the desktop/mobile apps:

1. Install Node.js dependencies:
   ```bash
   npm install
   ```
2. Start the local server:
   ```bash
   npm run dev
   ```
3. Open **http://localhost:8080** in your browser.
4. On the TV, point the Titan OS browser to your local IP: `http://192.168.x.x:8080`

---

## Deploy & Host (Web Version)

### Option A — Vercel

```bash
npm i -g vercel
vercel --prod
```

### Option B — Netlify

Drag the project folder onto [app.netlify.com/drop](https://app.netlify.com/drop).

### Option C — GitHub Pages

Push to GitHub → Settings → Pages → Deploy from `main` branch root.

---

## Submit to Titan OS Partner Portal

1. Host the app at a public HTTPS URL (see above).
2. Log in to [Titan OS Partner Portal](https://www.titanoperatingsystem.com/).
3. Create a new app submission and enter your hosted URL as the **App URL**.
4. Follow the wizard to submit for review.

---

## Configuration

At the top of `app.js`:

```js
const CONFIG = {
  channelsUrl:      './channels.json',   // path to channel data
  focusColor:       '#e5a00d',           // gold focus color
  overlayHideDelay: 3000,                // ms before player HUD fades
  skeletonCount:    15,                  // skeleton loading cards
};
```

---

## Remote Control / Keyboard Navigation

| Key | Action |
|-----|--------|
| Arrow keys | Move focus between sidebar / grid / top bar |
| Enter | Select / activate focused item |
| Esc / Backspace | Go back / close overlay |
| Any key / Tap | Show HUD overlay |

---

## File Structure

```
/
├── .github/workflows/ # Cloud build CI/CD pipelines
├── src-tauri/         # Desktop/Mobile configuration
├── scraper.py         # Scrapes parsatv.com → channels.json
├── scrape_url.py      # Standalone single-channel debug scraper
├── smart_categorizer.py # AI-powered dual-engine categorizing tool
├── stream_checker.py  # Validates stream URLs
├── index.html         # TV app entry point
├── app.js             # Navigation, player, search logic
├── style.css          # TV-optimized styles
├── channels.json      # Channel data (generated by scraper)
└── package.json       # Node dependencies
```
