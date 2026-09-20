"use client";

import { cellToLatLng } from "h3-js";
import mapboxgl from "mapbox-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "styled-system/jsx";
import { AnalyticsLayerControl } from "@/components/analytics-layer-control";
import { SeasonControl } from "@/components/season-control";
import { Timeline } from "@/components/timeline";
import {
  ANALYTICS_INTERACTIVE_LAYER_IDS,
  type AnalyticsLayerKey,
  addAnalyticsLayer,
  type CellClips,
  createDynamicCells,
  type PreparedCells,
  setAnalyticsLayer,
  setDynamicAnalyticsData,
  setSelectedAnalyticsCell,
  type WeatherSeries,
} from "@/lib/analytics-layer";
import {
  type AnalyticsSnapshot,
  type FirePopupProperties,
  firePopupHtml,
} from "@/lib/fire-popup";

type Position = [number, number];
type FireProperties = {
  observed_watermark?: string;
  n_hotspots?: number;
  area_m2?: number;
};

/**
 * Zoom band over which the heat glow hands off to measured perimeters. Below
 * the start the glow carries everything; above the end only real geometry shows.
 */
const FIRE_GLOW_FADE_START = 7.5;
const FIRE_GLOW_FADE_END = 9.5;
/** Where a ranked-zone click lands, close enough to read the cell. */
const ZONE_FLY_TO_ZOOM = 9;
/** Shared by the live perimeter outline and the past-burn rings. */
const FIRE_STROKE_COLOUR = "#ff6a3d";

export type SeasonCollection = {
  season: number;
  months: number[];
  totalAreaHa: number;
  features: unknown[];
};
type FireGeometry =
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };
type FireFeature = {
  type: "Feature";
  geometry: FireGeometry;
  properties: FireProperties;
};
type FireCollection = { type: "FeatureCollection"; features: FireFeature[] };
type CentroidCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: Position };
    properties: FireProperties;
  }>;
};

function visitPositions(value: unknown, positions: Position[]) {
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  )
    positions.push([value[0], value[1]]);
  else if (Array.isArray(value))
    for (const item of value) visitPositions(item, positions);
}
/**
 * Centroids for the season polygons, so past burns can be drawn as rings sized
 * by burnt area rather than as polygon outlines.
 */
function toPointFeatures(features: unknown[]) {
  return features.flatMap((feature) => {
    const typed = feature as {
      geometry?: { coordinates?: unknown };
      properties?: Record<string, unknown>;
    };
    const positions: Position[] = [];
    visitPositions(typed.geometry?.coordinates, positions);
    if (!positions.length) return [];
    const [longitude, latitude] = positions.reduce(
      ([lng, lat], [nextLng, nextLat]) => [
        lng + nextLng / positions.length,
        lat + nextLat / positions.length,
      ],
      [0, 0],
    );
    return [
      {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [longitude, latitude],
        },
        properties: typed.properties ?? {},
      },
    ];
  });
}

function toCentroids(collection: FireCollection): CentroidCollection {
  return {
    type: "FeatureCollection",
    features: collection.features.flatMap((feature) => {
      const positions: Position[] = [];
      visitPositions(feature.geometry.coordinates, positions);
      if (!positions.length) return [];
      const [longitude, latitude] = positions.reduce(
        ([lng, lat], [nextLng, nextLat]) => [
          lng + nextLng / positions.length,
          lat + nextLat / positions.length,
        ],
        [0, 0],
      );
      return [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [longitude, latitude] },
          properties: feature.properties,
        },
      ];
    }),
  };
}
export function WorldMap() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const activeLayerRef = useRef<AnalyticsLayerKey>("fuel");
  const selectedRef = useRef<number | null>(null);
  const [status, setStatus] = useState("Loading satellite data…");
  const [count, setCount] = useState<number>();
  const [analytics, setAnalytics] = useState<{
    status: "loading" | "error" | "ready";
    data: PreparedCells | null;
    clips: CellClips | null;
  }>({ status: "loading", data: null, clips: null });
  const [activeLayer, setActiveLayer] = useState<AnalyticsLayerKey>("fuel");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<
    "loading" | "error" | "ready"
  >("loading");
  const [weatherSeries, setWeatherSeries] = useState<WeatherSeries | null>(
    null,
  );
  const [dateIndex, setDateIndex] = useState<number | null>(null);
  const [layersReady, setLayersReady] = useState(false);
  const [season, setSeason] = useState<SeasonCollection | null>(null);
  const [seasonStatus, setSeasonStatus] = useState<
    "loading" | "error" | "ready"
  >("loading");
  const [seasonVisible, setSeasonVisible] = useState(true);

  /** The map effect runs once, so hover reads cells through a ref, not state. */
  const analyticsRef = useRef<AnalyticsSnapshot>({ data: null, lookup: null });
  useEffect(() => {
    analyticsRef.current = {
      data: analytics.data,
      lookup: analytics.data
        ? new Map(analytics.data.cells.map((cell, index) => [cell, index]))
        : null,
    };
  }, [analytics.data]);

  /** Centre the map on a ranked zone so a Top-zones click goes somewhere. */
  const focusCell = (index: number) => {
    setSelectedIndex(index);
    const cell = analytics.data?.cells[index];
    const map = mapRef.current;
    if (!cell || !map) return;
    const [latitude, longitude] = cellToLatLng(cell);
    map.flyTo({
      center: [longitude, latitude],
      zoom: Math.max(map.getZoom(), ZONE_FLY_TO_ZOOM),
      duration: 1200,
    });
  };

  /** Defaults to today the first time the series arrives. */
  const activeDateIndex = dateIndex ?? weatherSeries?.todayIndex ?? 0;

  const dynamic = useMemo(
    () =>
      analytics.data && weatherSeries
        ? createDynamicCells(analytics.data, weatherSeries, activeDateIndex)
        : null,
    [analytics.data, weatherSeries, activeDateIndex],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady || !analytics.data || !analytics.clips || !dynamic)
      return;
    setDynamicAnalyticsData(map, analytics.data, analytics.clips, dynamic);
  }, [analytics.data, analytics.clips, dynamic, layersReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady || !season) return;
    (
      map.getSource("season-centroids") as mapboxgl.GeoJSONSource | undefined
    )?.setData({
      type: "FeatureCollection",
      features: toPointFeatures(season.features),
    } as Parameters<mapboxgl.GeoJSONSource["setData"]>[0]);
  }, [season, layersReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady) return;
    for (const id of ["season-circles"]) {
      if (!map.getLayer(id)) continue;
      map.setLayoutProperty(
        id,
        "visibility",
        seasonVisible ? "visible" : "none",
      );
    }
  }, [seasonVisible, layersReady]);

  useEffect(() => {
    activeLayerRef.current = activeLayer;
    if (mapRef.current) setAnalyticsLayer(mapRef.current, activeLayer);
  }, [activeLayer]);
  useEffect(() => {
    selectedRef.current = selectedIndex;
    if (mapRef.current) setSelectedAnalyticsCell(mapRef.current, selectedIndex);
  }, [selectedIndex]);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_PK;
    if (!container.current || !token) {
      setStatus("Mapbox public token is not configured.");
      return;
    }
    let map: mapboxgl.Map | undefined;
    let refreshId: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    const fetchPerimeters = async () => {
      const response = await fetch("/api/fire-perimeters");
      if (!response.ok) throw new Error("Data request failed");
      return (await response.json()) as FireCollection;
    };
    const analyticsPromise = Promise.all([
      fetch("/data/grootguard-cells.json"),
      fetch("/data/spain-cell-clips.json"),
    ])
      .then(async ([cellsResponse, clipsResponse]) => {
        if (!cellsResponse.ok || !clipsResponse.ok)
          throw new Error("Analytics request failed");
        return {
          data: (await cellsResponse.json()) as PreparedCells,
          clips: (await clipsResponse.json()) as CellClips,
        };
      })
      .then((snapshot) => {
        if (!cancelled) setAnalytics({ status: "ready", ...snapshot });
        return snapshot;
      })
      .catch(() => {
        if (!cancelled)
          setAnalytics({ status: "error", data: null, clips: null });
        return null;
      });
    void fetch("/api/fire-history")
      .then(async (response) => {
        if (!response.ok) throw new Error("Season request failed");
        const payload = (await response.json()) as SeasonCollection;
        if (!Array.isArray(payload?.features))
          throw new Error("Season payload is not a collection");
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        setSeason(payload);
        setSeasonStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setSeasonStatus("error");
      });
    void fetch("/api/weather")
      .then(async (response) => {
        if (!response.ok) throw new Error("Weather request failed");
        const payload = (await response.json()) as WeatherSeries;
        // A cached response from an older deployment can arrive with a shape
        // this build no longer understands; treat that as unavailable.
        if (
          !Array.isArray(payload?.dates) ||
          !Array.isArray(payload?.regional) ||
          !Array.isArray(payload?.points) ||
          payload.dates.length === 0
        )
          throw new Error("Weather payload is not a usable series");
        return payload;
      })
      .then((series) => {
        if (cancelled) return;
        setWeatherSeries(series);
        setWeatherStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setWeatherStatus("error");
      });
    const setMapData = (perimeters: FireCollection) => {
      if (!map) return;
      (map.getSource("fire-perimeters") as mapboxgl.GeoJSONSource).setData(
        perimeters as unknown as Parameters<
          mapboxgl.GeoJSONSource["setData"]
        >[0],
      );
      (map.getSource("fire-centroids") as mapboxgl.GeoJSONSource).setData(
        toCentroids(perimeters) as unknown as Parameters<
          mapboxgl.GeoJSONSource["setData"]
        >[0],
      );
      setCount(perimeters.features.length);
      setStatus("Live satellite estimate");
    };
    const refresh = async () => {
      try {
        setMapData(await fetchPerimeters());
      } catch {
        setStatus("Satellite data is temporarily unavailable.");
      }
    };
    const start = async () => {
      try {
        const initialPerimeters = await fetchPerimeters();
        if (cancelled || !container.current) return;
        mapboxgl.accessToken = token;
        map = new mapboxgl.Map({
          container: container.current,
          style: "mapbox://styles/mapbox/standard",
          config: { basemap: { lightPreset: "night" } },
          center: [-3.7, 40.2],
          zoom: 5.2,
          attributionControl: true,
        });
        mapRef.current = map;
        map.on("load", () => {
          const loadedMap = map;
          if (!loadedMap) return;
          loadedMap.addSource("fire-perimeters", {
            type: "geojson",
            data: initialPerimeters,
          });
          loadedMap.addSource("fire-centroids", {
            type: "geojson",
            data: toCentroids(initialPerimeters),
          });
          loadedMap.addSource("season-centroids", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          // Past burns are drawn as hollow circles sized by burnt area, in the
          // same stroke colour as a live perimeter: same family, but a ring
          // rather than a filled shape, so "burning now" still reads first.
          loadedMap.addLayer({
            id: "season-circles",
            type: "circle",
            source: "season-centroids",
            paint: {
              "circle-color": "rgba(0,0,0,0)",
              "circle-stroke-color": FIRE_STROKE_COLOUR,
              "circle-stroke-opacity": 0.85,
              "circle-stroke-width": 1.2,
              "circle-emissive-strength": 1,
              // Radius tracks sqrt(area) so the ring area reads proportionally.
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5,
                [
                  "interpolate",
                  ["linear"],
                  ["sqrt", ["coalesce", ["get", "area_ha"], 1]],
                  1,
                  1.5,
                  30,
                  4,
                  280,
                  11,
                ],
                10,
                [
                  "interpolate",
                  ["linear"],
                  ["sqrt", ["coalesce", ["get", "area_ha"], 1]],
                  1,
                  4,
                  30,
                  13,
                  280,
                  34,
                ],
              ],
            },
          });
          loadedMap.addLayer({
            id: "fire-perimeter-fill",
            type: "fill",
            source: "fire-perimeters",
            paint: {
              "fill-color": "#ff3b30",
              "fill-emissive-strength": 1,
              // Hidden while the glow carries the story, then takes over.
              "fill-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                FIRE_GLOW_FADE_START,
                0,
                FIRE_GLOW_FADE_END,
                0.55,
              ],
            },
          });
          void analyticsPromise.then((snapshot) => {
            if (!snapshot || cancelled) return;
            addAnalyticsLayer(
              loadedMap,
              snapshot.data,
              snapshot.clips,
              "fire-perimeter-fill",
            );
            setAnalyticsLayer(loadedMap, activeLayerRef.current);
            setSelectedAnalyticsCell(loadedMap, selectedRef.current);
            setLayersReady(true);
            loadedMap.on("click", ANALYTICS_INTERACTIVE_LAYER_IDS, (event) => {
              const feature = event.features?.[0] as
                | { properties?: { index?: number } }
                | undefined;
              const index = Number(feature?.properties?.index);
              if (Number.isInteger(index)) setSelectedIndex(index);
            });
            loadedMap.on("mouseenter", ANALYTICS_INTERACTIVE_LAYER_IDS, () => {
              loadedMap.getCanvas().style.cursor = "pointer";
            });
            loadedMap.on("mouseleave", ANALYTICS_INTERACTIVE_LAYER_IDS, () => {
              loadedMap.getCanvas().style.cursor = "";
            });
          });
          loadedMap.addLayer({
            id: "fire-perimeter-line",
            type: "line",
            source: "fire-perimeters",
            paint: {
              "line-color": FIRE_STROKE_COLOUR,
              "line-emissive-strength": 1,
              // Invisible under the glow, then sharpens as the glow fades.
              "line-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                FIRE_GLOW_FADE_START,
                0,
                FIRE_GLOW_FADE_END,
                1,
              ],
              "line-width": 1.6,
            },
          });
          // Heat glow replaces the old centroid dots: a diffuse field at country
          // zoom that hands over to the measured perimeter as you zoom in, so
          // nothing ever reads as a pin at a precision the data does not have.
          loadedMap.addLayer({
            id: "fire-glow",
            type: "heatmap",
            source: "fire-centroids",
            paint: {
              "heatmap-weight": [
                "interpolate",
                ["linear"],
                ["coalesce", ["get", "n_hotspots"], 1],
                1,
                0.25,
                50,
                0.6,
                500,
                1,
              ],
              "heatmap-intensity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                4,
                1,
                FIRE_GLOW_FADE_END,
                2.4,
              ],
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                "rgba(0,0,0,0)",
                0.2,
                "rgba(120,30,10,0.55)",
                0.45,
                "rgba(214,78,22,0.75)",
                0.7,
                "rgba(249,140,42,0.88)",
                1,
                "rgba(255,226,150,0.95)",
              ],
              "heatmap-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                4,
                14,
                7,
                26,
                FIRE_GLOW_FADE_END,
                44,
              ],
              "heatmap-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                FIRE_GLOW_FADE_START,
                0.95,
                FIRE_GLOW_FADE_END,
                0,
              ],
            },
          });
          const hoverPopup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            maxWidth: "280px",
            offset: 12,
          });
          const FIRE_HOVER_LAYERS = ["fire-perimeter-fill", "season-circles"];
          loadedMap.on("mousemove", FIRE_HOVER_LAYERS, (event) => {
            const feature = event.features?.[0];
            if (!feature) return;
            loadedMap.getCanvas().style.cursor = "pointer";
            hoverPopup
              .setLngLat(event.lngLat)
              .setHTML(
                firePopupHtml(
                  (feature as unknown as { properties: FirePopupProperties })
                    .properties,
                  event.lngLat.lat,
                  event.lngLat.lng,
                  analyticsRef.current,
                ),
              )
              .addTo(loadedMap);
          });
          loadedMap.on("mouseleave", FIRE_HOVER_LAYERS, () => {
            loadedMap.getCanvas().style.cursor = "";
            hoverPopup.remove();
          });
          setMapData(initialPerimeters);
          refreshId = setInterval(() => void refresh(), 60_000);
        });
      } catch {
        setStatus("Satellite data is temporarily unavailable.");
      }
    };
    void start();
    return () => {
      cancelled = true;
      if (refreshId) clearInterval(refreshId);
      map?.remove();
      mapRef.current = null;
    };
  }, []);
  return (
    <Box as="main" height="dvh" position="relative" width="full">
      <Box ref={container} height="full" width="full" />
      <Flex
        as="section"
        aria-live="polite"
        color="slate.50"
        direction="column"
        gap="2"
        left="4"
        pointerEvents="none"
        position="absolute"
        top="4"
        zIndex="1"
      >
        <Box as="p" fontSize="sm" fontWeight="semibold" letterSpacing="widest">
          FIREWARD · SPAIN
        </Box>
        {/* Fixed width: long copy inside used to stretch this card across the map. */}
        <Flex
          background="slate.950/90"
          borderColor="slate.700"
          borderRadius="lg"
          borderWidth="1px"
          direction="column"
          gap="0.5"
          padding="3"
          width="64"
        >
          <Flex align="baseline" gap="2">
            {count !== undefined && (
              <Box as="strong" color="orange.400" fontSize="2xl" lineHeight="1">
                {count}
              </Box>
            )}
            <Box as="h1" fontSize="sm" fontWeight="semibold">
              active fire perimeters
            </Box>
          </Flex>
          <Box as="p" color="slate.400" fontSize="2xs">
            {status} · DeepFire, refreshed every minute
          </Box>
          <SeasonControl
            season={season}
            status={seasonStatus}
            visible={seasonVisible}
            onToggle={setSeasonVisible}
          />
        </Flex>
      </Flex>
      <AnalyticsLayerControl
        activeLayer={activeLayer}
        data={analytics.data}
        dateIndex={activeDateIndex}
        dynamic={dynamic}
        selectedIndex={selectedIndex}
        series={weatherSeries}
        status={analytics.status}
        weatherStatus={weatherStatus}
        onLayerChange={setActiveLayer}
        onSelectCell={focusCell}
      />
      <Timeline
        dateIndex={activeDateIndex}
        series={weatherSeries}
        status={weatherStatus}
        onDateIndexChange={setDateIndex}
      />
    </Box>
  );
}
