/**
 * Search strategy presets — one-click profiles that map to the underlying
 * zoom / depth / fast-mode / radius knobs. Inspired by the "Fast / Fastest /
 * Detailed / Zoom" strategies popularised by competing desktop scrapers, but
 * expressed as sensible defaults over our adaptive grid engine.
 *
 * Power users can still override every individual control after picking a
 * preset; the preset only pre-fills values.
 */

export type Strategy = "quick" | "standard" | "detailed" | "deep";

export interface StrategyPreset {
  /** Zoom level used for grid cell sizing and search URLs. */
  zoom: number;
  /** Scroll depth for normal (non-grid) searches. */
  depth: number;
  /** Whether to use fast mode (reduced data, quicker). */
  fastMode: boolean;
  /** Multiplier applied to the user's chosen radius. */
  radiusScale: number;
  /** Short human description shown in the UI. */
  description: string;
}

export const STRATEGIES: Record<Strategy, StrategyPreset> = {
  quick: {
    zoom: 14,
    depth: 3,
    fastMode: true,
    radiusScale: 1,
    description: "Fastest — fewer results, basic fields",
  },
  standard: {
    zoom: 15,
    depth: 10,
    fastMode: false,
    radiusScale: 1,
    description: "Balanced coverage and speed",
  },
  detailed: {
    zoom: 16,
    depth: 20,
    fastMode: false,
    radiusScale: 1,
    description: "Thorough — denser grid, deeper scroll",
  },
  deep: {
    zoom: 17,
    depth: 40,
    fastMode: false,
    radiusScale: 1.5,
    description: "Maximum coverage — slow, wide radius",
  },
};

export const STRATEGY_ORDER: Strategy[] = ["quick", "standard", "detailed", "deep"];

export interface StrategyBase {
  zoom: number;
  depth: number;
  radius: number;
  fastMode: boolean;
}

export interface StrategyResolved {
  zoom: number;
  depth: number;
  radius: number;
  fastMode: boolean;
}

/** Returns true when the given string is a known strategy key. */
export function isStrategy(value: unknown): value is Strategy {
  return typeof value === "string" && value in STRATEGIES;
}

/**
 * Resolve a strategy preset against the user's base settings. The preset
 * overrides zoom / depth / fastMode and scales the radius; any base value the
 * preset does not govern is passed through unchanged.
 */
export function applyStrategy(strategy: Strategy, base: StrategyBase): StrategyResolved {
  const preset = STRATEGIES[strategy];
  return {
    zoom: preset.zoom,
    depth: preset.depth,
    fastMode: preset.fastMode,
    radius: Math.round(base.radius * preset.radiusScale),
  };
}
