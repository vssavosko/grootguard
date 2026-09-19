import { cellToBoundary } from "h3-js";
import type mapboxgl from "mapbox-gl";

export type AnalyticsLayerKey = "fuel" | "population-assets" | null;
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
};

type Position = [number, number];
export type CellClips = {
  excluded: string[];
  clipped: Record<string, Position[][][]>;
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
  };
};

const SOURCE_ID = "spain-analytics";
const FUEL_LAYER_ID = "spain-fuel";
const POPULATION_LAYER_ID = "spain-population";
const ASSET_LAYER_ID = "spain-assets";
const SELECTED_LAYER_ID = "spain-analytics-selected";
export const ANALYTICS_INTERACTIVE_LAYER_IDS = [
  FUEL_LAYER_ID,
  POPULATION_LAYER_ID,
];

export function fuelIndex(tree: number, shrub: number, grass: number) {
  return tree + 0.8 * shrub + 0.5 * grass;
}

export function createAnalyticsFeatures(
  data: PreparedCells,
  clips: CellClips,
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
  visibility(map, FUEL_LAYER_ID, key === "fuel");
  visibility(map, POPULATION_LAYER_ID, key === "population-assets");
  visibility(map, ASSET_LAYER_ID, key === "population-assets");
}

export function setSelectedAnalyticsCell(
  map: mapboxgl.Map,
  index: number | null,
) {
  if (map.getLayer(SELECTED_LAYER_ID))
    map.setFilter(SELECTED_LAYER_ID, ["==", ["get", "index"], index ?? -1]);
}
