# Google Maps Scraper

Desktop app for scraping Google Maps leads, plus the download website.

## Structure

```
├── app/        Electron desktop app (React + Vite + Playwright)
└── website/    Download landing page (GitHub Pages)
```

## Desktop App (`app/`)

Cross-platform Electron app that scrapes Google Maps for business leads with adaptive grid search, proxy support, and CSV export.

### Prerequisites

- Node.js 20+
- npm

### Development

```bash
cd app
npm install
npm run dev
```

### Build

```bash
npm run build:mac     # macOS
npm run build:win     # Windows
npm run build:linux   # Linux
```

Build artifacts land in `app/release/`.

## Website (`website/`)

Static download page with OS auto-detection. Deployed to GitHub Pages on push to `main` (see `.github/workflows/deploy.yml`).

No build step — just open `website/index.html` locally to preview.

## Releases

Binaries are published as [GitHub Releases](https://github.com/userisaziz/gscrapper/releases). The download page links to the latest release assets.
