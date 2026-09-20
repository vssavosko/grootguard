import { cellToBoundary } from "h3-js";
import type mapboxgl from "mapbox-gl";

export type AnalyticsLayerKey =
  | "priority"
  | "fuel"
  | "weather"
  | "moisture"
  | "population-assets"
  | null;
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
  assets: number[][];
  asset_classes: string[];
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
export type WeatherSnapshot = {
  generatedAt: string;
  cutoff: string;
  moistureObservedAt: string;
  points: Array<{
    current: { weather: number | null; moisture: number | null };
  }>;
};
export type DynamicCells = {
  weather: Array<number | null>;
  moisture: Array<number | null>;
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
const SELECTED_LAYER_ID = "spain-analytics-selected";
export const ANALYTICS_INTERACTIVE_LAYER_IDS = [
  PRIORITY_LAYER_ID,
  FUEL_LAYER_ID,
  WEATHER_LAYER_ID,
  MOISTURE_LAYER_ID,
  POPULATION_LAYER_ID,
];

export function fuelIndex(tree: number, shrub: number, grass: number) {
  return tree + 0.8 * shrub + 0.5 * grass;
}

export function createDynamicCells(
  data: PreparedCells,
  snapshot: WeatherSnapshot,
): DynamicCells {
  const valid = snapshot.points.length === data.weather_points.length;
  const read = (index: number, key: "weather" | "moisture") => {
    const value = valid
      ? snapshot.points[data.wpt[index]]?.current[key]
      : undefined;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const weather = data.cells.map((_, index) => read(index, "weather"));
  const moisture = data.cells.map((_, index) => read(index, "moisture"));
  return { weather, moisture };
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
          priority: null,
          previous_priority: null,
          rank_change: null,
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
            -5,
            "#1d4ed8",
            5,
            "#38bdf8",
            15,
            "#facc15",
            25,
            "#f97316",
            35,
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
