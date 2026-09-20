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
import { type FireCollection, toFireCoverage } from "@/lib/fire-coverage";

/** Where a ranked-zone click lands, close enough to read the cell. */
const ZONE_FLY_TO_ZOOM = 9;

export type SeasonCollection = {
  season: number;
  months: number[];
  totalAreaHa: number;
  features: unknown[];
};

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
      map.getSource("season-coverage") as mapboxgl.GeoJSONSource | undefined
    )?.setData(toFireCoverage(season, 6));
  }, [season, layersReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady) return;
    for (const id of ["season-coverage-fill", "season-coverage-line"]) {
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
      (map.getSource("fire-coverage-overview") as mapboxgl.GeoJSONSource).setData(
        toFireCoverage(perimeters, 5) as unknown as Parameters<
          mapboxgl.GeoJSONSource["setData"]
        >[0],
      );
      (map.getSource("fire-coverage-detail") as mapboxgl.GeoJSONSource).setData(
        toFireCoverage(perimeters, 7) as unknown as Parameters<
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
          loadedMap.addSource("fire-coverage-overview", {
            type: "geojson",
            data: toFireCoverage(initialPerimeters, 5),
          });
          loadedMap.addSource("fire-coverage-detail", {
            type: "geojson",
            data: toFireCoverage(initialPerimeters, 7),
          });
          loadedMap.addSource("season-coverage", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          loadedMap.addLayer({
            id: "season-coverage-fill",
            type: "fill",
            source: "season-coverage",
            paint: {
              "fill-color": "#98513b",
              "fill-emissive-strength": 0.35,
              "fill-opacity": 0.46,
            },
          });
          loadedMap.addLayer({
            id: "season-coverage-line",
            type: "line",
            source: "season-coverage",
            paint: {
              "line-color": "#e8ad79",
              "line-emissive-strength": 0.45,
              "line-opacity": 0.72,
              "line-width": 0.85,
            },
          });
          void analyticsPromise.then((snapshot) => {
            if (!snapshot || cancelled) return;
            addAnalyticsLayer(
              loadedMap,
              snapshot.data,
              snapshot.clips,
              "fire-coverage-overview-fill",
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
            id: "fire-coverage-overview-halo",
            type: "line",
            source: "fire-coverage-overview",
            paint: {
              "line-color": "#ff8a3d",
              "line-emissive-strength": 1,
              "line-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5.8,
                0.32,
                6.8,
                0,
              ],
              "line-width": 4,
            },
          });
          loadedMap.addLayer({
            id: "fire-coverage-overview-fill",
            type: "fill",
            source: "fire-coverage-overview",
            paint: {
              "fill-color": "#f4512c",
              "fill-emissive-strength": 1.2,
              "fill-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5.8,
                0.76,
                6.8,
                0,
              ],
            },
          });
          loadedMap.addLayer({
            id: "fire-coverage-overview-line",
            type: "line",
            source: "fire-coverage-overview",
            paint: {
              "line-color": "#ffd18a",
              "line-emissive-strength": 1.2,
              "line-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5.8,
                0.95,
                6.8,
                0,
              ],
              "line-width": 1.25,
            },
          });
          loadedMap.addLayer({
            id: "fire-coverage-detail-fill",
            type: "fill",
            source: "fire-coverage-detail",
            paint: {
              "fill-color": "#ff4d24",
              "fill-emissive-strength": 1,
              "fill-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5.8,
                0,
                6.8,
                0.8,
              ],
            },
          });
          loadedMap.addLayer({
            id: "fire-coverage-detail-line",
            type: "line",
            source: "fire-coverage-detail",
            paint: {
              "line-color": "#ffe1a6",
              "line-emissive-strength": 1.5,
              "line-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5.8,
                0,
                6.8,
                0.95,
              ],
              "line-width": 1,
            },
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
