/**
 * CSV writer — async streaming Entry rows to a CSV file with proper quoting.
 * Uses fs.promises to avoid blocking the main process event loop.
 */
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { CSV_HEADERS, Entry, entryToCsvRow } from "./entry";

/**
 * Escape a CSV field value: wrap in quotes if it contains
 * commas, quotes, or newlines. Double any embedded quotes.
 */
export function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

// ─── Per-file write serialization ────────────────────────────────────────────
//
// Entries are written from a parallel page pool (Promise.allSettled). Without
// serialization, two large rows (reviews/images JSON can be many KB) could be
// flushed concurrently and interleave on disk, corrupting the CSV. We chain
// all writes to a given file behind a promise queue so appends are atomic per
// file while different files still write independently.
const locks = new Map<string, Promise<void>>();

function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(filePath) ?? Promise.resolve();
  // Run fn after the previous write settles (success or failure). A failed
  // write must not poison subsequent ones, so we branch on both outcomes.
  const run = prev.then(fn, fn);
  // Keep the chain alive but swallow errors in the stored tail.
  locks.set(filePath, run.then(() => undefined, () => undefined));
  return run;
}

/**
 * Write entries to a CSV file asynchronously. Creates the file with headers
 * if it doesn't exist, appends rows if it does. Serialized per file.
 */
export async function writeEntriesToCsv(filePath: string, entries: Entry[]): Promise<void> {
  if (entries.length === 0) return;

  await withFileLock(filePath, async () => {
    const dir = path.dirname(filePath);
    await fsp.mkdir(dir, { recursive: true });

    const isNew = !fs.existsSync(filePath);
    const lines: string[] = [];

    if (isNew) {
      lines.push(CSV_HEADERS.map(escapeCsvField).join(","));
    }

    for (const entry of entries) {
      const row = entryToCsvRow(entry);
      lines.push(row.map(escapeCsvField).join(","));
    }

    await fsp.appendFile(filePath, lines.join("\n") + "\n", "utf-8");
  });
}

/**
 * Write a single entry to a CSV file (append mode, async).
 */
export async function appendEntryToCsv(filePath: string, entry: Entry): Promise<void> {
  await writeEntriesToCsv(filePath, [entry]);
}

/**
 * Initialize a CSV file with headers only.
 */
export async function initCsvFile(filePath: string): Promise<void> {
  await withFileLock(filePath, async () => {
    const dir = path.dirname(filePath);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(filePath, CSV_HEADERS.map(escapeCsvField).join(",") + "\n", "utf-8");
  });
}
