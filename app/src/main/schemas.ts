/**
 * IPC contract schemas — runtime validation for all renderer→main messages.
 * Every IPC handler validates its input against these schemas before processing.
 */
import { z } from "zod";

// ─── Scrape ─────────────────────────────────────────────────────────────────

export const ScrapeStartSchema = z.object({
  name: z.string().max(200).default("Untitled Job"),
  keywords: z.string().min(1, "At least one keyword is required").max(10_000),
  lang: z.string().min(2).max(10).default("en"),
  zoom: z.number().int().min(1).max(21).default(15),
  lat: z.string().regex(/^-?\d+(\.\d+)?$/, "Invalid latitude").default("0"),
  lon: z.string().regex(/^-?\d+(\.\d+)?$/, "Invalid longitude").default("0"),
  depth: z.number().int().min(1).max(100).default(10),
  email: z.boolean().default(true),
  fast_mode: z.boolean().default(false),
  radius: z.number().min(100).max(500_000).default(10_000),
  max_time: z.string().regex(/^\d+(m|s|h)$/, "Format: <number><m|s|h>").default("15m"),
  proxies: z.string().max(50_000).default(""),
  delay: z.number().min(0).max(300).default(0),
  strategy: z.enum(["quick", "standard", "detailed", "deep"]).default("standard"),
  monitor_reviews: z.boolean().default(false),
  reviews_after: z.string().optional(),
  reviews_before: z.string().optional(),
});

export type ScrapeStartInput = z.infer<typeof ScrapeStartSchema>;

// ─── License ────────────────────────────────────────────────────────────────

export const LoginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required").max(200),
});

export type LoginInput = z.infer<typeof LoginSchema>;

// ─── Job operations ─────────────────────────────────────────────────────────

export const JobIdSchema = z.string().uuid("Invalid job ID");

// ─── Duration parsing ───────────────────────────────────────────────────────

export function parseDuration(s: string): number {
  const match = s.match(/^(\d+)(m|s|h)$/);
  if (!match) return 600;
  const val = parseInt(match[1]!, 10);
  switch (match[2]!) {
    case "s": return val;
    case "m": return val * 60;
    case "h": return val * 3600;
    default: return 600;
  }
}
