/**
 * Geographic grid utilities for splitting a search area into smaller cells.
 * Ported from gosom/grid/grid.go.
 *
 * Google Maps caps the number of results it returns for a single search in one
 * spot (roughly a hundred). By dividing the target radius into a grid of
 * smaller cells and issuing one search per cell, we can retrieve far more
 * results than any single search allows — this is how the scraper reaches
 * "everything in the area" instead of stopping at the first page.
 */

const KM_PER_DEGREE_LAT = 111.32;
const MIN_COS_LATITUDE = 1e-6;
/** Web-mercator ground resolution at zoom 0 (meters/pixel). */
const METERS_PER_PIXEL_ZOOM0 = 156543.03392;
/** Width of the search viewport in pixels (must match buildSearchUrl). */
const VIEWPORT_W = 600;

export interface BoundingBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export interface GridCell {
  lat: number;
  lon: number;
}

/**
 * A searchable cell: a center point plus the zoom level (which fixes the
 * viewport size) and the approximate ground size of the cell. Carrying the
 * size and zoom lets us subdivide a cell into smaller, higher-zoom children.
 */
export interface SearchCell {
  lat: number;
  lon: number;
  zoom: number;
  sizeKm: number;
}

/**
 * Build a bounding box around a center point extending `radiusM` metres in
 * every direction.
 */
export function boundingBoxFromCenter(lat: number, lon: number, radiusM: number): BoundingBox {
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

/**
 * Choose a grid cell size (km) so each cell is roughly the width of the search
 * viewport at the given zoom, scaled down significantly so neighbouring cells
 * overlap heavily and no businesses fall through the cracks. The 0.6 factor
 * means ~40% overlap between adjacent cells — critical for dense urban areas
 * where Google's viewport-based ranking shifts results between searches.
 */
export function cellSizeKmForZoom(lat: number, zoom: number): number {
  const metersPerPixel = (METERS_PER_PIXEL_ZOOM0 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  const viewportWidthKm = (VIEWPORT_W * metersPerPixel) / 1000;
  return Math.max(0.2, viewportWidthKm * 0.6);
}

/**
 * Divide `bbox` into a grid of cells approximately `cellSizeKm` on a side and
 * return the center of every cell. The longitude step is adjusted for latitude
 * so cells are roughly square on the ground.
 */
export function generateCells(bbox: BoundingBox, cellSizeKm: number): GridCell[] {
  const size = cellSizeKm > 0 ? cellSizeKm : 1;
  const latStep = size / KM_PER_DEGREE_LAT;
  const lonStep = lonStepFor(bbox, size);

  const cells: GridCell[] = [];
  for (let lat = bbox.minLat + latStep / 2; lat < bbox.maxLat; lat += latStep) {
    for (let lon = bbox.minLon + lonStep / 2; lon < bbox.maxLon; lon += lonStep) {
      cells.push({ lat, lon });
    }
  }
  return cells;
}

/**
 * Generate cells but grow the cell size as needed so the total stays at or
 * below `maxCells`. Keeps runtime bounded for very large radii while still
 * covering the whole area.
 */
export function generateCellsCapped(bbox: BoundingBox, cellSizeKm: number, maxCells: number): GridCell[] {
  let size = cellSizeKm;
  let cells = generateCells(bbox, size);

  for (let i = 0; i < 12 && cells.length > maxCells; i++) {
    size *= 1.35;
    cells = generateCells(bbox, size);
  }
  return cells;
}

/**
 * Split a cell into four quadrant sub-cells at one zoom level higher.
 *
 * Raising the zoom halves the viewport's linear size (quarters its area), and
 * the four sub-cell centers are placed at the quadrant offsets so their
 * smaller viewports tile the parent cell. Re-searching a dense cell this way
 * surfaces businesses that were cut off by Google's ~100-results-per-search
 * cap, because each sub-search now covers a smaller slice of the cluster.
 */
export function subdivideCell(cell: SearchCell): SearchCell[] {
  const latSpan = cell.sizeKm / KM_PER_DEGREE_LAT;
  const cosLat = clampCosLat(Math.cos((cell.lat * Math.PI) / 180));
  const lonSpan = cell.sizeKm / (KM_PER_DEGREE_LAT * cosLat);

  const subSize = cell.sizeKm / 2;
  const subZoom = cell.zoom + 1;

  const subs: SearchCell[] = [];
  for (const dLat of [-1, 1]) {
    for (const dLon of [-1, 1]) {
      subs.push({
        lat: cell.lat + (dLat * latSpan) / 4,
        lon: cell.lon + (dLon * lonSpan) / 4,
        zoom: subZoom,
        sizeKm: subSize,
      });
    }
  }
  return subs;
}

function lonStepFor(bbox: BoundingBox, cellSizeKm: number): number {
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const cosMidLat = clampCosLat(Math.cos((midLat * Math.PI) / 180));
  return cellSizeKm / (KM_PER_DEGREE_LAT * cosMidLat);
}

function clampCosLat(v: number): number {
  if (Math.abs(v) < MIN_COS_LATITUDE) {
    return v < 0 ? -MIN_COS_LATITUDE : MIN_COS_LATITUDE;
  }
  return v;
}
