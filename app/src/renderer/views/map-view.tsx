import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import "leaflet/dist/leaflet.css";
import { Grid } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Circle,
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { toast } from "sonner";
import { GridOverlay, computeGridCellCount } from "@/components/grid-overlay";
import { LocationSearch } from "@/components/location-search";
import {
  DEFAULT_FORM,
  ScrapeConfigPanel,
  type ScrapeFormState,
} from "@/components/scrape-config-panel";
import { useJobs, useStartScrape } from "@/hooks/use-jobs";
import type { View } from "@/lib/navigation";
import { cn } from "@/lib/utils";

// Fix Leaflet default marker icons under a bundler.
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

/** Captures the Leaflet map instance for imperative control. */
function MapInstance({ mapRef }: { mapRef: React.MutableRefObject<L.Map | null> }) {
  const map = useMap();
  mapRef.current = map;
  return null;
}

/** Forwards map clicks to the parent. */
function ClickHandler({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

interface MapViewProps {
  onNavigate: (view: View) => void;
}

export function MapView({ onNavigate }: MapViewProps) {
  const [form, setForm] = useState<ScrapeFormState>(DEFAULT_FORM);
  const [showGrid, setShowGrid] = useState(true);
  const mapRef = useRef<L.Map | null>(null);

  const startScrape = useStartScrape();
  // Keep the jobs cache warm so the Jobs view is instant after navigating.
  useJobs(true);

  const lat = parseFloat(form.lat) || 25.2048;
  const lon = parseFloat(form.lon) || 55.2708;

  const gridCellCount = useMemo(
    () => computeGridCellCount(lat, lon, form.radius, form.zoom),
    [lat, lon, form.radius, form.zoom]
  );

  const patch = useCallback(
    (p: Partial<ScrapeFormState>) => setForm((f) => ({ ...f, ...p })),
    []
  );

  const setCenter = useCallback(
    (newLat: number, newLon: number, pan = true) => {
      patch({ lat: newLat.toFixed(6), lon: newLon.toFixed(6) });
      if (pan && mapRef.current) mapRef.current.panTo([newLat, newLon]);
    },
    [patch]
  );

  const handleMarkerDrag = useCallback(
    (e: L.DragEndEvent) => {
      const pos = (e.target as L.Marker).getLatLng();
      setCenter(pos.lat, pos.lng, false);
    },
    [setCenter]
  );

  const handleLocationSelect = useCallback(
    (newLat: number, newLon: number, bounds: { south: number; north: number; west: number; east: number } | null) => {
      patch({ lat: newLat.toFixed(6), lon: newLon.toFixed(6) });
      const map = mapRef.current;
      if (!map) return;
      if (bounds) {
        map.fitBounds(
          [
            [bounds.south, bounds.west],
            [bounds.north, bounds.east],
          ],
          { maxZoom: 15, padding: [10, 10] }
        );
      } else {
        map.setView([newLat, newLon], 12);
      }
    },
    [patch]
  );

  const handleStart = useCallback(() => {
    if (!form.keywords.trim()) {
      toast.error("Enter at least one keyword.");
      return;
    }
    startScrape.mutate(
      {
        name: form.name || "Untitled Job",
        keywords: form.keywords,
        lang: form.lang || "en",
        zoom: form.zoom || 15,
        lat: form.lat || "0",
        lon: form.lon || "0",
        depth: form.depth || 10,
        email: form.email,
        fast_mode: form.fastMode,
        radius: form.radius || 10000,
        max_time: form.maxTime || "10m",
        proxies: form.proxies || "",
        delay: form.delay || 0,
        strategy: form.strategy || "standard",
        monitor_reviews: form.monitorReviews,
        reviews_after: form.reviewsAfter || undefined,
        reviews_before: form.reviewsBefore || undefined,
      },
      {
        onSuccess: () => onNavigate("jobs"),
        onError: (err) => {
          const s = String(err);
          if (s.includes("subscription") || s.includes("login")) {
            toast.error("Subscription error — please sign in again.");
          } else {
            toast.error(s);
          }
        },
      }
    );
  }, [form, startScrape, onNavigate]);

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={[lat, lon]}
        zoom={13}
        zoomControl={false}
        attributionControl={false}
        className="h-full w-full"
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
        <MapInstance mapRef={mapRef} />
        <ClickHandler onClick={(a, b) => setCenter(a, b)} />
        <Marker
          position={[lat, lon]}
          draggable
          eventHandlers={{ dragend: handleMarkerDrag }}
        />
        <Circle
          center={[lat, lon]}
          radius={form.radius}
          pathOptions={{
            color: "#3b82f6",
            fillColor: "#3b82f6",
            fillOpacity: 0.08,
            weight: 1.5,
            dashArray: "4 4",
          }}
        />
        <GridOverlay
          lat={lat}
          lon={lon}
          radius={form.radius}
          zoom={form.zoom}
          visible={showGrid}
        />
      </MapContainer>

      {/* Location search — floating top center */}
      <div className="absolute left-1/2 top-4 z-[500] w-80 -translate-x-1/2">
        <LocationSearch onSelect={handleLocationSelect} />
      </div>

      {/* Grid toggle — floating top right */}
      <div className="absolute right-4 top-4 z-[500] flex items-center gap-2">
        <button
          onClick={() => setShowGrid((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur-sm transition-colors",
            showGrid
              ? "border-green-500/40 bg-green-500/15 text-green-700 dark:text-green-400"
              : "border-border bg-card/90 text-muted-foreground hover:bg-muted"
          )}
        >
          <Grid className="h-3.5 w-3.5" />
          Grid {showGrid ? "On" : "Off"}
        </button>
        {showGrid && (
          <span className="rounded-md bg-card/90 px-2 py-1 text-[11px] font-medium tabular-nums text-muted-foreground shadow-sm backdrop-blur-sm">
            {gridCellCount} cells
          </span>
        )}
      </div>

      {/* Scrape config — floating left */}
      <div className="absolute bottom-4 left-4 top-16 z-[500] flex">
        <ScrapeConfigPanel
          form={form}
          onChange={patch}
          onSubmit={handleStart}
          starting={startScrape.isPending}
        />
      </div>
    </div>
  );
}
