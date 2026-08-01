import { Loader2, MapPin, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  boundingbox: string[];
}

export interface LocationBounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

interface LocationSearchProps {
  onSelect: (lat: number, lon: number, bounds: LocationBounds | null) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

async function fetchPlaces(q: string, limit: number, signal: AbortSignal) {
  const url = `${NOMINATIM}?format=json&limit=${limit}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? (data as NominatimResult[]) : [];
}

function toBounds(r: NominatimResult): LocationBounds | null {
  if (!Array.isArray(r.boundingbox) || r.boundingbox.length !== 4) return null;
  const [south, north, west, east] = r.boundingbox.map(parseFloat);
  if ([south, north, west, east].some(Number.isNaN)) return null;
  return { south, north, west, east };
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Floating city / place search with debounced Nominatim autocomplete.
 * Shows a suggestion dropdown while typing; supports full keyboard navigation.
 */
export function LocationSearch({ onSelect }: LocationSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced autocomplete fetch (min 3 chars, 350 ms debounce).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      fetchPlaces(q, 6, ctrl.signal)
        .then((data) => {
          setResults(data);
          setOpen(data.length > 0);
          setActive(-1);
        })
        .catch((err) => {
          if ((err as Error).name !== "AbortError") setResults([]);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  // Close the dropdown on outside click.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);

  const select = useCallback(
    (r: NominatimResult) => {
      abortRef.current?.abort();
      setQuery(r.display_name.split(",")[0] ?? r.display_name);
      setOpen(false);
      setResults([]);
      setLoading(false);
      onSelect(parseFloat(r.lat), parseFloat(r.lon), toBounds(r));
    },
    [onSelect]
  );

  /** Explicit search (button / Enter with no highlight): pick best result. */
  const searchNow = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    if (results.length > 0) {
      select(results[Math.max(active, 0)] ?? results[0]);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const data = await fetchPlaces(q, 6, ctrl.signal);
      if (data.length > 0) {
        select(data[0]);
      } else {
        setResults([]);
        setOpen(false);
      }
    } catch {
      // network error — leave input as-is
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [query, results, active, select]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (results.length) {
          setOpen(true);
          setActive((a) => (a + 1) % results.length);
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (results.length) setActive((a) => (a - 1 + results.length) % results.length);
        break;
      case "Enter":
        e.preventDefault();
        if (open && active >= 0 && results[active]) select(results[active]);
        else void searchNow();
        break;
      case "Escape":
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-2 rounded-lg border border-border/70 bg-card/90 p-1.5 shadow-lg backdrop-blur-md">
        <Input
          placeholder="Search city, country, or place…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label="Search location"
          className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <Button
          size="sm"
          type="button"
          onClick={() => void searchNow()}
          disabled={loading || !query.trim()}
          className="h-8 px-3"
          aria-label="Search"
        >
          {loading ? <Loader2 className="animate-spin" /> : <Search />}
        </Button>
      </div>

      {open && results.length > 0 && (
        <ul
          role="listbox"
          aria-label="Location suggestions"
          className="absolute top-full z-[600] mt-1.5 max-h-72 w-full overflow-y-auto rounded-lg border border-border/70 bg-popover py-1 shadow-xl"
        >
          {results.map((r, i) => {
            const [primary, ...rest] = r.display_name.split(",");
            return (
              <li key={r.place_id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault(); // keep input focus
                    select(r);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors",
                    i === active && "bg-accent text-accent-foreground"
                  )}
                >
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{primary}</span>
                    {rest.length > 0 && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {rest.join(",").trim()}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
