import { cellToBoundary } from "h3-js";
import type mapboxgl from "mapbox-gl";
import { priority as priorityOf, rankChanges } from "@/lib/weather-model";

export type AnalyticsLayerKey =
  | "priority"
  | "fuel"
  | "weather"
  | "moisture"
  | "soil-water"
  | "population-assets"
  | null;

/** Rank deltas compare a date with the same weekday one week earlier. */
export const RANK_COMPARISON_DAYS = 7;
export type SelectedCell = {
  index: number;
  longitude: number;
  latitude: number;
};

export type PreparedCells = {
  cells: string[];
  tree: number[];
  shrub: number[];
  grass: number[];
  land_frac: number[];
  area_ha: number[];
  pop: number[];
  /** Population weighted by the burnable fraction of the cell. */
  pop_exposed: number[];
  /** Population within 10 km, for surrounding exposure. */
  pop10km: number[];
  assets: number[][];
  asset_classes: string[];
  asset_score: number[];
  /** Index into `asset_classes` for the cell's most significant asset. */
  top_asset: number[];
  top_asset_name: Array<string | null>;
  name: Array<string | null>;
  province: Array<string | null>;
  C: number[];
  wpt: number[];
  weather_points: string[];
};

type Position = [number, number];
export type CellClips = {
  excluded: string[];
  clipped: Record<string, Position[][][]>;
};
export type DayKind = "observed" | "combined" | "forecast";
export type PointDay = {
  date: string;
  kind: DayKind;
  maxTemperature: number | null;
  humidity: number | null;
  maxWind: number | null;
  precipitation: number | null;
  daysSinceRain: number | null;
  precipitation30Day: number | null;
  weather: number | null;
  moisture: number | null;
};
/** Client-side mirror of the `/api/weather` payload. */
export type WeatherSeries = {
  /** True when the series came from a recorded fixture, not the provider. */
  fixture?: boolean;
  generatedAt: string;
  today: string;
  dates: string[];
  todayIndex: number;
  baselineSource: "climatology" | "rolling";
  moistureObservedAt: string;
  regional: Array<{ latitude: number; longitude: number; days: PointDay[] }>;
  points: Array<{ regional: number; soilWaterIndex: number | null }>;
};
export type DynamicCells = {
  /** Fire-weather factor W for the selected date. */
  weather: Array<number | null>;
  /** Moisture factor M for the selected date. */
  moisture: Array<number | null>;
  /** Observed Copernicus soil water index; not part of the timeline. */
  soilWater: Array<number | null>;
  priority: Array<number | null>;
  previousPriority: Array<number | null>;
  rankChange: Array<number | null>;
};

type AnalyticsFeature = {
  type: "Feature";
  geometry:
    | { type: "Polygon"; coordinates: Position[][] }
    | { type: "MultiPolygon"; coordinates: Position[][][] };
  properties: {
    index: number;
    fuel_index: number;
    population: number;
    has_vegetation: number;
    has_assets: number;
    data_status: "ready" | "no-data";
    weather: number | null;
    moisture: number | null;
    soil_water: number | null;
    priority: number | null;
    previous_priority: number | null;
    rank_change: number | null;
  };
};

const SOURCE_ID = "spain-analytics";
const FUEL_LAYER_ID = "spain-fuel";
const POPULATION_LAYER_ID = "spain-population";
const ASSET_LAYER_ID = "spain-assets";
const PRIORITY_LAYER_ID = "spain-priority";
const WEATHER_LAYER_ID = "spain-weather";
const MOISTURE_LAYER_ID = "spain-moisture";
const SOIL_WATER_LAYER_ID = "spain-soil-water";
const SELECTED_LAYER_ID = "spain-analytics-selected";
export const ANALYTICS_INTERACTIVE_LAYER_IDS = [
  PRIORITY_LAYER_ID,
  FUEL_LAYER_ID,
  WEATHER_LAYER_ID,
  MOISTURE_LAYER_ID,
  SOIL_WATER_LAYER_ID,
  POPULATION_LAYER_ID,
];

export function fuelIndex(tree: number, shrub: number, grass: number) {
  return tree + 0.8 * shrub + 0.5 * grass;
}

const finiteOrNull = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Expand the regional weather series onto every cell for one date, and derive
 * the prevention priority from it.
 *
 * `priority = F * W * (0.4 + 0.6 * (1 - M)) * C`, exactly as the design spec
 * states. A cell whose weather point has no usable W or M is excluded from the
 * ranking rather than scored as zero.
 */
export function createDynamicCells(
  data: PreparedCells,
  series: WeatherSeries,
  dateIndex: number,
): DynamicCells {
  const aligned = series.points.length === data.weather_points.length;
  const dayAt = (cellIndex: number, index: number): PointDay | undefined => {
    if (!aligned || index < 0) return undefined;
    const point = series.points[data.wpt[cellIndex]];
    return series.regional[point?.regional ?? -1]?.days[index];
  };
  const previousIndex = Math.max(0, dateIndex - RANK_COMPARISON_DAYS);

  const scoreAt = (cellIndex: number, index: number) => {
    const day = dayAt(cellIndex, index);
    const weather = finiteOrNull(day?.weather);
    const moisture = finiteOrNull(day?.moisture);
    const fuel = finiteOrNull(
      fuelIndex(
        data.tree[cellIndex],
        data.shrub[cellIndex],
        data.grass[cellIndex],
      ),
    );
    const consequence = finiteOrNull(data.C[cellIndex]);
    return weather === null ||
      moisture === null ||
      fuel === null ||
      consequence === null
      ? null
      : priorityOf(fuel, weather, moisture, consequence);
  };

  const weather = data.cells.map((_, index) =>
    finiteOrNull(dayAt(index, dateIndex)?.weather),
  );
  const moisture = data.cells.map((_, index) =>
    finiteOrNull(dayAt(index, dateIndex)?.moisture),
  );
  const soilWater = data.cells.map((_, index) =>
    aligned
      ? finiteOrNull(series.points[data.wpt[index]]?.soilWaterIndex)
      : null,
  );
  const priority = data.cells.map((_, index) => scoreAt(index, dateIndex));
  const previousPriority = data.cells.map((_, index) =>
    scoreAt(index, previousIndex),
  );
  return {
    weather,
    moisture,
    soilWater,
    priority,
    previousPriority,
    rankChange: rankChanges(priority, previousPriority),
  };
}

export function createAnalyticsFeatures(
  data: PreparedCells,
  clips: CellClips,
  dynamic?: DynamicCells,
): AnalyticsFeature[] {
  const excluded = new Set(clips.excluded);
  return data.cells.flatMap((cell, index) => {
    if (excluded.has(cell)) return [];
    const tree = data.tree[index];
    const shrub = data.shrub[index];
    const grass = data.grass[index];
    const population = data.pop[index];
    const assets = data.assets[index];
    const ready = [tree, shrub, grass, population, ...assets].every(
      Number.isFinite,
    );
    const fuel = fuelIndex(tree, shrub, grass);
    const ring = cellToBoundary(cell, true) as Position[];
    const clipped = clips.clipped[cell];

    return [
      {
        type: "Feature",
        geometry: clipped
          ? { type: "MultiPolygon", coordinates: clipped }
          : { type: "Polygon", coordinates: [[...ring, ring[0]]] },
        properties: {
          index,
          fuel_index: fuel,
          population,
          has_vegetation: fuel > 0 ? 1 : 0,
          has_assets: assets.reduce((sum, value) => sum + value, 0) > 0 ? 1 : 0,
          data_status: ready ? "ready" : "no-data",
          weather: dynamic?.weather[index] ?? null,
          moisture: dynamic?.moisture[index] ?? null,
          soil_water: dynamic?.soilWater[index] ?? null,
          priority: dynamic?.priority[index] ?? null,
          previous_priority: dynamic?.previousPriority[index] ?? null,
          rank_change: dynamic?.rankChange[index] ?? null,
        },
      },
    ];
  });
}

function visibility(map: mapboxgl.Map, id: string, visible: boolean) {
  if (map.getLayer(id))
    map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
}

const neutralColour = [
  "case",
  ["==", ["get", "data_status"], "no-data"],
  "#64748b",
  ["==", ["get", "has_vegetation"], 0],
  "#334155",
] as mapboxgl.Expression;

export function addAnalyticsLayer(
  map: mapboxgl.Map,
  data: PreparedCells,
  clips: CellClips,
  beforeLayerId: string,
) {
  if (map.getSource(SOURCE_ID)) return;
  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: createAnalyticsFeatures(data, clips),
    },
  });
  map.addLayer(
    {
      id: PRIORITY_LAYER_ID,
      type: "fill",
      source: SOURCE_ID,
      layout: { visibility: "none" },
      paint: {
        "fill-color": [
          "case",
          ["!=", ["get", "priority"], null],
          [
            "interpolate",
            ["linear"],
            ["get", "priority"],
            0,
            "#1d4ed8",
            5,
            "#facc15",
            25,
            "#fb923c",
            100,
            "#f97316",
          ],
          "#64748b",
        ],
        "fill-emissive-strength": 1,
        "fill-opacity": 0.68,
      },
    },
    beforeLayerId,
  );
  map.addLayer(
    {
      id: FUEL_LAYER_ID,
      type: "fill",
      source: SOURCE_ID,
      paint: {
        "fill-color": [
          ...neutralColour,
          [
            "interpolate",
            ["linear"],
            ["get", "fuel_index"],
            0,
            "#1d4ed8",
            0.5,
            "#f59e0b",
            1,
            "#ef4444",
          ],
        ],
        "fill-emissive-strength": 1,
        "fill-opacity": 0.55,
      },
    },
    beforeLayerId,
  );
  map.addLayer(
    {
      id: WEATHER_LAYER_ID,
      type: "fill",
      source: SOURCE_ID,
      layout: { visibility: "none" },
      paint: {
        "fill-color": [
          "case",
          ["!=", ["get", "weather"], null],
          [
            "interpolate",
            ["linear"],
            ["get", "weather"],
            0.6,
            "#1d4ed8",
            0.9,
            "#38bdf8",
            1.1,
            "#facc15",
            1.35,
            "#f97316",
            1.6,
            "#dc2626",
          ],
          "#64748b",
        ],
        "fill-emissive-strength": 1,
        "fill-opacity": 0.6,
      },
    },
    beforeLayerId,
  );
  map.addLayer(
    {
      id: MOISTURE_LAYER_ID,
      type: "fill",
      source: SOURCE_ID,
      layout: { visibility: "none" },
      paint: {
        "fill-color": [
          "case",
          ["!=", ["get", "moisture"], null],
          [
            "interpolate",
            ["linear"],
            ["get", "moisture"],
            0,
            "#dc2626",
            0.35,
            "#facc15",
            0.7,
            "#38bdf8",
            1,
            "#2563eb",
          ],
          "#64748b",
        ],
        "fill-emissive-strength": 1,
        "fill-opacity": 0.6,
      },
    },
    beforeLayerId,
  );
  map.addLayer(
    {
      id: SOIL_WATER_LAYER_ID,
      type: "fill",
      source: SOURCE_ID,
      layout: { visibility: "none" },
      paint: {
        "fill-color": [
          "case",
          ["!=", ["get", "soil_water"], null],
          [
            "interpolate",
            ["linear"],
            ["get", "soil_water"],
            0,
            "#dc2626",
            25,
            "#facc15",
            50,
            "#38bdf8",
            75,
            "#2563eb",
          ],
          "#64748b",
        ],
        "fill-emissive-strength": 1,
        "fill-opacity": 0.6,
      },
    },
    beforeLayerId,
  );
  map.addLayer(
    {
      id: POPULATION_LAYER_ID,
      type: "fill",
      source: SOURCE_ID,
      layout: { visibility: "none" },
      paint: {
        "fill-color": [
          ...neutralColour,
          [
            "interpolate",
            ["linear"],
            ["get", "population"],
            0,
            "#0ea5e9",
            100,
            "#a3e635",
            1_000,
            "#f97316",
            10_000,
            "#e11d48",
          ],
        ],
        "fill-emissive-strength": 1,
        "fill-opacity": 0.55,
      },
    },
    beforeLayerId,
  );
  map.addLayer(
    {
      id: ASSET_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      layout: { visibility: "none" },
      filter: ["==", ["get", "has_assets"], 1],
      paint: { "line-color": "#f8fafc", "line-width": 1, "line-opacity": 0.8 },
    },
    beforeLayerId,
  );
  map.addLayer(
    {
      id: SELECTED_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      filter: ["==", ["get", "index"], -1],
      paint: { "line-color": "#f8fafc", "line-width": 2.5 },
    },
    beforeLayerId,
  );
}

export function setAnalyticsLayer(map: mapboxgl.Map, key: AnalyticsLayerKey) {
  visibility(map, PRIORITY_LAYER_ID, key === "priority");
  visibility(map, FUEL_LAYER_ID, key === "fuel");
  visibility(map, WEATHER_LAYER_ID, key === "weather");
  visibility(map, MOISTURE_LAYER_ID, key === "moisture");
  visibility(map, SOIL_WATER_LAYER_ID, key === "soil-water");
  visibility(map, POPULATION_LAYER_ID, key === "population-assets");
  visibility(map, ASSET_LAYER_ID, key === "population-assets");
}

export function setDynamicAnalyticsData(
  map: mapboxgl.Map,
  data: PreparedCells,
  clips: CellClips,
  dynamic: DynamicCells,
) {
  const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
  if (source)
    source.setData({
      type: "FeatureCollection",
      features: createAnalyticsFeatures(data, clips, dynamic),
    } as Parameters<mapboxgl.GeoJSONSource["setData"]>[0]);
}

export function setSelectedAnalyticsCell(
  map: mapboxgl.Map,
  index: number | null,
) {
  if (map.getLayer(SELECTED_LAYER_ID))
    map.setFilter(SELECTED_LAYER_ID, ["==", ["get", "index"], index ?? -1]);
}
