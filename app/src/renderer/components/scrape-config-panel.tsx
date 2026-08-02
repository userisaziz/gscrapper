import { ChevronDown, Lightbulb, Loader2, Play, SlidersHorizontal, Globe } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ProxyIndicator } from "@/components/proxy-indicator";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { LANGUAGES } from "@/lib/languages";
import { cn } from "@/lib/utils";

export interface ScrapeFormState {
  name: string;
  keywords: string;
  lang: string;
  lat: string;
  lon: string;
  radius: number;
  zoom: number;
  depth: number;
  email: boolean;
  fastMode: boolean;
  maxTime: string;
  delay: number;
  proxies: string;
  strategy: string;
  monitorReviews: boolean;
  reviewsAfter: string;
  reviewsBefore: string;
}

export const DEFAULT_FORM: ScrapeFormState = {
  name: "",
  keywords: "",
  lang: "en",
  lat: "25.2048",
  lon: "55.2708",
  radius: 10000,
  zoom: 15,
  depth: 10,
  email: false,
  fastMode: false,
  maxTime: "15m",
  delay: 3,
  proxies: "",
  strategy: "standard",
  monitorReviews: false,
  reviewsAfter: "",
  reviewsBefore: "",
};

/**
 * Strategy presets mirrored from the main-process strategy module (the
 * renderer bundle cannot import main-process code). Picking a preset
 * auto-fills zoom/depth/fastMode; radius is scaled server-side.
 */
const STRATEGY_OPTIONS: {
  value: string;
  label: string;
  description: string;
  zoom: number;
  depth: number;
  fastMode: boolean;
}[] = [
  { value: "quick", label: "Quick", description: "Fastest — fewer results, basic fields", zoom: 14, depth: 3, fastMode: true },
  { value: "standard", label: "Standard", description: "Balanced coverage and speed", zoom: 15, depth: 10, fastMode: false },
  { value: "detailed", label: "Detailed", description: "Thorough — denser grid, deeper scroll", zoom: 16, depth: 20, fastMode: false },
  { value: "deep", label: "Deep", description: "Maximum coverage — slow, wide radius", zoom: 17, depth: 40, fastMode: false },
];

interface ScrapeConfigPanelProps {
  form: ScrapeFormState;
  onChange: (patch: Partial<ScrapeFormState>) => void;
  onSubmit: () => void;
  starting: boolean;
}

/** A small inline hint with a lightbulb icon. */
function Hint({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] leading-snug",
        tone === "warn"
          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "bg-muted/60 text-muted-foreground"
      )}
    >
      <Lightbulb className="mt-px h-3 w-3 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function Section({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-1 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground cursor-pointer">
        <span className="flex items-center gap-1.5">
          {icon}
          {title}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-1 pb-3 pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function ScrapeConfigPanel({ form, onChange, onSubmit, starting }: ScrapeConfigPanelProps) {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  const radiusLabel =
    form.radius >= 1000 ? `${(form.radius / 1000).toFixed(1)} km` : `${form.radius} m`;

  // Grid-based coverage estimate — mirrors the engine's actual cell calculation.
  const keywordCount = form.keywords.split("\n").filter((k) => k.trim()).length || 1;
  const latNum = parseFloat(form.lat) || 0;
  const cosLat = Math.max(Math.abs(Math.cos((latNum * Math.PI) / 180)), 1e-6);
  const metersPerPixel = (156543.03392 * cosLat) / Math.pow(2, form.zoom || 15);
  const cellSizeKm = Math.max(0.3, (600 * metersPerPixel) / 1000 * 0.85);
  const bboxLatSpan = (2 * form.radius) / 1000 / 111.32;
  const bboxLonSpan = (2 * form.radius) / 1000 / (111.32 * cosLat);
  const latStep = cellSizeKm / 111.32;
  const lonStep = cellSizeKm / (111.32 * cosLat);
  const gridCells = Math.max(1, Math.ceil(bboxLatSpan / latStep) * Math.ceil(bboxLonSpan / lonStep));
  const totalSearches = Math.min(gridCells * keywordCount, 1200);
  // Conservative yield: 2–10 unique leads per grid search after dedup & radius filter.
  const estLow = Math.round(totalSearches * 2);
  const estHigh = Math.round(totalSearches * 10);
  const coverageLabel = estHigh > 20000 ? `~${(estLow / 1000).toFixed(0)}k–${(estHigh / 1000).toFixed(0)}k` : `~${estLow.toLocaleString()}–${estHigh.toLocaleString()}`;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex max-h-full w-80 flex-col overflow-hidden rounded-xl border border-border/70 bg-card/90 shadow-xl backdrop-blur-md"
    >
      <div className="flex-1 space-y-1 overflow-y-auto p-4">
        <Section title="Job Configuration" icon={<SlidersHorizontal className="h-3.5 w-3.5" />}>
          <div className="space-y-1.5">
            <Label className="text-xs">Strategy</Label>
            <Select
              value={form.strategy}
              onValueChange={(v) => {
                const preset = STRATEGY_OPTIONS.find((s) => s.value === v);
                if (preset) {
                  // Auto-fill the individual controls; they stay editable.
                  onChange({
                    strategy: preset.value,
                    zoom: preset.zoom,
                    depth: preset.depth,
                    fastMode: preset.fastMode,
                  });
                } else {
                  onChange({ strategy: v });
                }
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STRATEGY_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value} className="text-xs">
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {STRATEGY_OPTIONS.find((s) => s.value === form.strategy)?.description ?? ""}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="job-name" className="text-xs">Job Name</Label>
            <Input
              id="job-name"
              placeholder="e.g. Dubai Restaurants"
              value={form.name}
              onChange={(e) => onChange({ name: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="job-keywords" className="text-xs">Keywords (one per line)</Label>
            <Textarea
              id="job-keywords"
              rows={4}
              placeholder={"cafes in Dubai\nrestaurants in DIFC\ngyms in Marina"}
              value={form.keywords}
              onChange={(e) => onChange({ keywords: e.target.value })}
              className="text-xs"
            />
            <Hint>
              Use multiple keyword variations for maximum coverage — e.g. "IT companies",
              "software companies", "tech startups", "SaaS companies". Each keyword runs its
              own full grid pass; duplicates are removed automatically.
            </Hint>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Language</Label>
            <Select value={form.lang} onValueChange={(v) => onChange({ lang: v })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.value} value={l.value} className="text-xs">
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Section>

        <Separator />

        <Section title="Location & Radius" icon={<Globe className="h-3.5 w-3.5" />}>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="lat" className="text-xs">Latitude</Label>
              <Input
                id="lat"
                type="number"
                step="any"
                value={form.lat}
                onChange={(e) => onChange({ lat: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lon" className="text-xs">Longitude</Label>
              <Input
                id="lon"
                type="number"
                step="any"
                value={form.lon}
                onChange={(e) => onChange({ lon: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Radius</Label>
              <span className="text-[11px] tabular-nums text-muted-foreground">{radiusLabel}</span>
            </div>
            <Slider
              min={500}
              max={50000}
              step={500}
              value={[form.radius]}
              onValueChange={([v]) => onChange({ radius: v })}
            />
            {form.radius >= 20000 && (
              <Hint tone="warn">
                Large radius detected. For a city-wide scrape, pair this with the "Deep"
                strategy and increase Max Job Time to 30–60 min so the grid has time to
                cover every cell.
              </Hint>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="zoom" className="text-xs">Zoom Level (0–21)</Label>
            <Input
              id="zoom"
              type="number"
              min={0}
              max={21}
              value={form.zoom}
              onChange={(e) => onChange({ zoom: parseInt(e.target.value) || 0 })}
              className="h-8 text-xs"
            />
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            ⓘ Click the map to set the center — drag the marker to fine-tune.
          </p>
        </Section>

        <Separator />

        <Section title="Advanced Options" defaultOpen={false}>
          <div className="flex items-center gap-2">
            <Checkbox
              id="fastmode"
              checked={form.fastMode}
              onCheckedChange={(v) => onChange({ fastMode: v === true })}
            />
            <Label htmlFor="fastmode" className="text-xs font-normal">Fast Mode (reduced data)</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="email"
              checked={form.email}
              onCheckedChange={(v) => onChange({ email: v === true })}
            />
            <Label htmlFor="email" className="text-xs font-normal">Enrich from websites (emails, phones, socials)</Label>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="monitor-reviews"
                checked={form.monitorReviews}
                onCheckedChange={(v) => onChange({ monitorReviews: v === true })}
              />
              <Label htmlFor="monitor-reviews" className="text-xs font-normal">Monitor reviews (track changes across runs)</Label>
            </div>
            {form.monitorReviews && (
              <div className="grid grid-cols-2 gap-2 pl-6">
                <div className="space-y-1.5">
                  <Label htmlFor="reviews-after" className="text-xs">After</Label>
                  <Input
                    id="reviews-after"
                    type="date"
                    value={form.reviewsAfter}
                    onChange={(e) => onChange({ reviewsAfter: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reviews-before" className="text-xs">Before</Label>
                  <Input
                    id="reviews-before"
                    type="date"
                    value={form.reviewsBefore}
                    onChange={(e) => onChange({ reviewsBefore: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="depth" className="text-xs">Scroll Depth</Label>
              <Input
                id="depth"
                type="number"
                min={1}
                value={form.depth}
                onChange={(e) => onChange({ depth: parseInt(e.target.value) || 1 })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maxtime" className="text-xs">Max Job Time</Label>
              <Input
                id="maxtime"
                value={form.maxTime}
                onChange={(e) => onChange({ maxTime: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <Hint>
            Google caps each search at ~100 results. The engine works around this by
            splitting your radius into a grid of cells (up to 1,200 searches). Give it
            enough time: 10 min ≈ 2–3k leads, 30 min ≈ 8–10k, 60 min ≈ 15k+.
          </Hint>
          <div className="space-y-1.5">
            <Label htmlFor="delay" className="text-xs">Delay between searches (sec)</Label>
            <Input
              id="delay"
              type="number"
              min={0}
              max={120}
              value={form.delay}
              onChange={(e) => onChange({ delay: parseInt(e.target.value) || 0 })}
              className="h-8 text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Random wait up to this many seconds before each search. 0 = off.
            </p>
          </div>
        </Section>

        <Separator />

        <Section title="Proxies" defaultOpen={false}>
          <div className="space-y-1.5">
            <Label htmlFor="proxies" className="text-xs">Proxy list (one per line)</Label>
            <Textarea
              id="proxies"
              rows={3}
              placeholder={"socks5://127.0.0.1:9050\nhttp://user:pass@proxy:8080"}
              value={form.proxies}
              onChange={(e) => onChange({ proxies: e.target.value })}
              className="text-xs"
            />
            <ProxyIndicator proxyText={form.proxies} />
            <Hint>
              Long scrapes (15+ min) can trigger Google rate-limiting. Rotating residential
              proxies keep the grid running without blocks. Proxies are health-checked
              before the job starts.
            </Hint>
          </div>
        </Section>
      </div>

      <div className="border-t p-3 space-y-2">
        <div className="flex items-center justify-between rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px]">
          <span className="text-muted-foreground">Grid searches</span>
          <span className="font-medium tabular-nums">{totalSearches} cells</span>
        </div>
        <div className="flex items-center justify-between rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px]">
          <span className="text-muted-foreground">Est. leads (approx)</span>
          <span className="font-medium tabular-nums">{coverageLabel}</span>
        </div>
        <Button type="submit" className="w-full" disabled={starting}>
          {starting ? (
            <>
              <Loader2 className="animate-spin" />
              Starting…
            </>
          ) : (
            <>
              <Play />
              Start Scraping
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
