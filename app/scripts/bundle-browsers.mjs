/**
 * Bundle the Playwright Chromium "headless shell" for every target platform so
 * the packaged installers are fully self-contained — the end user does NOT need
 * Node.js, nor to click "Install Now", nor to download anything extra.
 *
 * Our scraper always launches Chromium with `headless: true`, and Playwright
 * serves headless launches from the smaller `chromium-headless-shell` build
 * (verified: a headless launch succeeds with ONLY the shell present). So we
 * bundle just that binary per platform (~196 MB extracted each), not the full
 * ~356 MB Chrome.
 *
 * The browser revision/version are read straight from playwright-core's
 * browsers.json so the bundle always matches the installed Playwright version.
 *
 * Layout produced (consumed by electron-builder extraResources):
 *   browsers/<os>-<arch>/chromium_headless_shell-<rev>/
 *     INSTALLATION_COMPLETE
 *     chrome-headless-shell-<cft-platform>/...   (extracted zip contents)
 *
 * Downloads are cached: a platform is skipped if its INSTALLATION_COMPLETE
 * marker already exists, so re-runs are cheap.
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const require = createRequire(import.meta.url);
// extract-zip preserves unix file modes (exec bits) from the archive, which the
// Linux/macOS binaries need in order to launch. It is the same library Electron
// uses to extract its own binary, so it is already a transitive dependency.
const extract = require("extract-zip");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browsersRoot = path.join(root, "browsers");
const CDN = "https://cdn.playwright.dev/builds/cft";

// Read the exact Chromium build Playwright expects.
const browsersJson = JSON.parse(
  await fs.readFile(
    path.join(root, "node_modules/playwright-core/browsers.json"),
    "utf-8",
  ),
);
const chromium = browsersJson.browsers.find((b) => b.name === "chromium");
if (!chromium) throw new Error("chromium entry not found in browsers.json");
const REVISION = chromium.revision; // e.g. "1234"
const VERSION = chromium.browserVersion; // e.g. "151.0.7922.34"

// Bundle dir name (matches electron-builder `browsers/<os>-${arch}`) → the
// Chrome-for-Testing platform token used in the download URL and zip folder.
const TARGETS = [
  { dir: "mac-arm64", token: "mac-arm64" },
  { dir: "mac-x64", token: "mac-x64" },
  { dir: "linux-x64", token: "linux64" },
  { dir: "win-x64", token: "win64" },
];

async function download(url, dest) {
  console.log(`  ↓ ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  }
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

console.log(
  `Bundling Playwright headless-shell (chromium r${REVISION}, v${VERSION})\n`,
);
await fs.mkdir(browsersRoot, { recursive: true });

for (const target of TARGETS) {
  const shellDir = path.join(
    browsersRoot,
    target.dir,
    `chromium_headless_shell-${REVISION}`,
  );
  const marker = path.join(shellDir, "INSTALLATION_COMPLETE");

  if (existsSync(marker)) {
    console.log(`• ${target.dir}: already bundled, skipping`);
    continue;
  }

  console.log(`• ${target.dir}: downloading…`);
  const url = `${CDN}/${VERSION}/${target.token}/chrome-headless-shell-${target.token}.zip`;
  const zipPath = path.join(
    browsersRoot,
    `chrome-headless-shell-${target.token}.zip`,
  );

  const extractTmp = path.join(browsersRoot, target.dir, `_extract-${target.token}`);
  try {
    await fs.mkdir(path.join(browsersRoot, target.dir), { recursive: true });
    await download(url, zipPath);

    await fs.mkdir(extractTmp, { recursive: true });
    await extract(zipPath, { dir: extractTmp });

    // The zip's single top-level folder is named chrome-headless-shell-<token>;
    // discover it dynamically and preserve that exact name (Playwright resolves
    // the executable relative to it).
    const entries = await fs.readdir(extractTmp);
    const innerName = entries.find((e) =>
      e.startsWith("chrome-headless-shell"),
    );
    if (!innerName) {
      throw new Error(
        `Unexpected zip layout for ${target.token}: ${entries.join(", ")}`,
      );
    }

    await fs.mkdir(shellDir, { recursive: true });
    await fs.rename(
      path.join(extractTmp, innerName),
      path.join(shellDir, innerName),
    );
    // Playwright treats this marker as "install finished successfully".
    await fs.writeFile(marker, "");

    console.log(`  ✓ bundled ${target.dir}/${innerName}`);
  } finally {
    await fs.rm(extractTmp, { recursive: true, force: true });
    await fs.rm(zipPath, { force: true });
  }
}

console.log("\nDone. Browsers staged in ./browsers for electron-builder.");
