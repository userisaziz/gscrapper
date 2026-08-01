<div align="center">

# Google Maps Scraper

**Extract business leads from Google Maps — right from your desktop.**

A cross-platform Electron app that scrapes Google Maps for business data using adaptive grid search, website enrichment, proxy rotation, and anti-detection resilience.

[![Release](https://img.shields.io/github/v/release/userisaziz/gscrapper?label=release&color=22c55e)](https://github.com/userisaziz/gscrapper/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/userisaziz/gscrapper/releases)
[![License](https://img.shields.io/badge/license-Private-lightgrey)](#)

[Download](https://github.com/userisaziz/gscrapper/releases) · [Features](#features) · [Getting Started](#getting-started) · [Project Structure](#project-structure)

</div>

---

## What It Does

Google Maps Scraper automates lead generation by searching Google Maps for businesses matching your keywords and location, then enriching each result with deep data extraction — all packaged in a clean desktop UI.

1. **Search** — Define keywords, a center location, and a search radius
2. **Grid Scan** — The engine splits the area into an adaptive geographic grid to bypass Google's per-search result cap
3. **Enrich** — Visits each business's website to extract emails, phones, social links, and descriptions
4. **Export** — Streams results to CSV in real time as they're discovered

---

## Features

### Scraping Engine

| Feature | Description |
|---------|-------------|
| Adaptive Grid Search | Divides the target radius into geographic cells, subdividing dense areas automatically to capture results beyond Google's ~100-per-search limit |
| Search Strategy Presets | One-click profiles — Quick, Standard, Detailed, Deep — that tune zoom, scroll depth, and speed |
| Website Enrichment | Visits each lead's website with a real browser to extract emails, phone numbers, social media links, descriptions, and key people |
| Review Extraction | RPC-based pagination via Google's batchexecute endpoint with DOM scraping fallback, plus date-range filtering |
| Real-time CSV Export | Results stream to disk as they're found — no waiting for the full job to finish |
| Job Management | Persistent job history with status tracking, cancellation, and resume |

### Resilience & Anti-Detection

| Feature | Description |
|---------|-------------|
| Proxy Rotation | Health-checks proxies upfront, rotates through healthy ones with randomized pacing |
| User-Agent Rotation | Cycles through a pool of realistic browser fingerprints per context |
| Block Detection & Cooldown | Detects CAPTCHA / consent walls and enters a configurable cooldown before retrying |
| Browser Crash Recovery | Automatically relaunches Chromium on fatal crashes mid-job |

### Desktop App

| Feature | Description |
|---------|-------------|
| Cross-Platform | Windows (x64), macOS (Intel + Apple Silicon), Linux (AppImage) |
| Interactive Map | Pick search center and visualize coverage with Leaflet |
| Dark / Light Theme | System-aware theme toggle |
| Auto-Update | Built-in updater checks for new releases |
| License System | Hardware-bound license activation with offline grace period |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop Shell | Electron 33 |
| Frontend | React 18, Vite 6, Tailwind CSS 4, Radix UI, TanStack Query |
| Scraping | Playwright (headless Chromium) |
| Data Parsing | Cheerio, Zod validation |
| Storage | better-sqlite3 (local job/review store) |
| Auth / Licensing | Supabase (auth + edge functions) |
| Map UI | Leaflet + react-leaflet |
| Testing | Vitest |

---

## Getting Started

### Prerequisites

- **Node.js** 20+
- **npm**

### Development

```bash
cd app
npm install
npm run dev
```

This compiles the main/preload processes, starts the Vite dev server, and launches Electron with hot reload.

### Build

```bash
npm run build:mac     # macOS (Intel + ARM)
npm run build:win     # Windows x64
npm run build:linux   # Linux AppImage
```

Build artifacts land in `app/release/`.

### Test

```bash
npm run test          # run all tests
npm run test:watch    # watch mode
npm run test:coverage # with coverage report
```

---

## Project Structure

```
├── app/                        Electron desktop application
│   ├── src/
│   │   ├── main/              Main process
│   │   │   ├── scraper/       Scraping engine, grid, proxy, resilience, enrichment
│   │   │   ├── store/         SQLite persistence (jobs, reviews)
│   │   │   ├── license/       Hardware-bound license management
│   │   │   ├── ipc.ts         IPC handlers (renderer ↔ main)
│   │   │   └── updater.ts     Auto-update logic
│   │   ├── preload/           Context bridge
│   │   └── renderer/          React UI (views, components, hooks)
│   └── scripts/               Build helpers (browser bundling, config injection)
├── website/                   Download landing page (GitHub Pages)
└── .github/workflows/         CI/CD (deploy website on push to main)
```

---

## Website

Static download page with automatic OS detection. Deployed to GitHub Pages on push to `main`.

No build step — open `website/index.html` locally to preview.

---

## Releases

Binaries are published as [GitHub Releases](https://github.com/userisaziz/gscrapper/releases). The download page auto-detects the visitor's OS and links to the appropriate asset.

| Platform | Asset |
|----------|-------|
| Windows x64 | `Google-Maps-Scraper-Setup-x.x.x.exe` |
| macOS Apple Silicon | `Google-Maps-Scraper-x.x.x-arm64.dmg` |
| macOS Intel | `Google-Maps-Scraper-x.x.x.dmg` |
| Linux x64 | `Google-Maps-Scraper-x.x.x.AppImage` |

---

<div align="center">

**Built with Electron + Playwright + React**

</div>
