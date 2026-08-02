/**
 * GridOverlay — visualizes the search grid cells on the Leaflet map.
 * Replicates the engine's grid math (grid.ts) in the renderer so users
 * can see exactly how the area will be divided before scraping.
 */
import { useMemo } from "react";
import { Rectangle, Tooltip } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";

// ─── Grid math (mirrors app/src/main/scraper/grid.ts) ──────────────────────

const KM_PER_DEGREE_LAT = 111.32;
const METERS_PER_PIXEL_ZOOM0 = 156543.03392;
const VIEWPORT_W = 600;
const MAX_CELLS = 2000;

interface BBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

interface Cell {
  lat: number;
  lon: number;
  halfLat: number;
  halfLon: number;
}

function clampCosLat(v: number): number {
  return Math.abs(v) < 1e-6 ? 1e-6 : v;
}

function boundingBox(lat: number, lon: number, radiusM: number): BBox {
  const latDelta = radiusM / 1000 / KM_PER_DEGREE_LAT;
  const cosLat = clampCosLat(Math.cos((lat * Math.PI) / 180));
  const lonDelta = radiusM / 1000 / (KM_PER_DEGREE_LAT * cosLat);
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta,
  };
}

function cellSizeKm(lat: number, zoom: number): number {
  const metersPerPixel = (METERS_PER_PIXEL_ZOOM0 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  const viewportWidthKm = (VIEWPORT_W * metersPerPixel) / 1000;
  return Math.max(0.2, viewportWidthKm * 0.6);
}

function generateCells(bbox: BBox, sizeKm: number): Cell[] {
  const latStep = sizeKm / KM_PER_DEGREE_LAT;
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const cosMid = clampCosLat(Math.cos((midLat * Math.PI) / 180));
  const lonStep = sizeKm / (KM_PER_DEGREE_LAT * cosMid);

  const cells: Cell[] = [];
  for (let lat = bbox.minLat + latStep / 2; lat < bbox.maxLat; lat += latStep) {
    for (let lon = bbox.minLon + lonStep / 2; lon < bbox.maxLon; lon += lonStep) {
      cells.push({ lat, lon, halfLat: latStep / 2, halfLon: lonStep / 2 });
    }
  }
  return cells;
}

function generateCellsCapped(bbox: BBox, sizeKm: number): Cell[] {
  let size = sizeKm;
  let cells = generateCells(bbox, size);
  for (let i = 0; i < 12 && cells.length > MAX_CELLS; i++) {
    size *= 1.35;
    cells = generateCells(bbox, size);
  }
  return cells;
}

// ─── Component ──────────────────────────────────────────────────────────────

interface GridOverlayProps {
  lat: number;
  lon: number;
  radius: number;
  zoom: number;
  visible: boolean;
}

export function GridOverlay({ lat, lon, radius, zoom, visible }: GridOverlayProps) {
  // The engine uses gridZoom = max(zoom + 1, 16)
  const gridZoom = Math.max(zoom + 1, 16);

  const cells = useMemo(() => {
    if (!visible) return [];
    const bbox = boundingBox(lat, lon, radius);
    const size = cellSizeKm(lat, gridZoom);
    return generateCellsCapped(bbox, size);
  }, [lat, lon, radius, gridZoom, visible]);

  if (!visible || cells.length === 0) return null;

  return (
    <>
      {cells.map((cell, i) => {
        const bounds: LatLngBoundsExpression = [
          [cell.lat - cell.halfLat, cell.lon - cell.halfLon],
          [cell.lat + cell.halfLat, cell.lon + cell.halfLon],
        ];
        return (
          <Rectangle
            key={i}
            bounds={bounds}
            pathOptions={{
              color: "#22c55e",
              weight: 0.8,
              opacity: 0.6,
              fillColor: "#22c55e",
              fillOpacity: 0.04,
            }}
          >
            <Tooltip direction="center" permanent={false} className="text-[10px]">
              Cell {i + 1}
            </Tooltip>
          </Rectangle>
        );
      })}
    </>
  );
}

/** Returns the number of grid cells for given params (used in UI labels). */
export function computeGridCellCount(lat: number, lon: number, radius: number, zoom: number): number {
  const gridZoom = Math.max(zoom + 1, 16);
  const bbox = boundingBox(lat, lon, radius);
  const size = cellSizeKm(lat, gridZoom);
  const cells = generateCellsCapped(bbox, size);
  return cells.length;
}
