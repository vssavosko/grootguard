"use client";

import { AnalyticsLayerControl } from "@/components/analytics-layer-control";
import {
  addAnalyticsLayer,
  ANALYTICS_INTERACTIVE_LAYER_IDS,
  type AnalyticsLayerKey,
  type CellClips,
  type PreparedCells,
  setAnalyticsLayer,
  setSelectedAnalyticsCell,
} from "@/lib/analytics-layer";
import mapboxgl from "mapbox-gl";
import { useEffect, useRef, useState } from "react";
import { Box, Flex } from "styled-system/jsx";

type Position = [number, number];
type FireProperties = {
  observed_watermark?: string;
  n_hotspots?: number;
  area_m2?: number;
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
function popupText(properties: FireProperties) {
  const observed = properties.observed_watermark
    ? new Date(properties.observed_watermark).toLocaleString()
    : "Unknown";
  const area = properties.area_m2
    ? `${(properties.area_m2 / 1_000_000).toFixed(2)} km²`
    : "Unknown";
  return `Active fire perimeter\nObserved ${observed}\n${area} · ${properties.n_hotspots ?? 0} hotspots\nSatellite estimate — not an official boundary`;
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
          loadedMap.addLayer({
            id: "fire-perimeter-fill",
            type: "fill",
            source: "fire-perimeters",
            paint: {
              "fill-color": "#ff3b30",
              "fill-emissive-strength": 1,
              "fill-opacity": 0.5,
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
              "line-color": "#ff3b30",
              "line-emissive-strength": 1,
              "line-width": 3,
            },
          });
          loadedMap.addLayer({
            id: "fire-centroids",
            type: "circle",
            source: "fire-centroids",
            paint: {
              "circle-color": "#ff3b30",
              "circle-emissive-strength": 1,
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                4,
                4,
                8,
                8,
              ],
              "circle-stroke-color": "#fff",
              "circle-stroke-width": 2,
            },
          });
          loadedMap.on("click", "fire-perimeter-fill", (event) => {
            const feature = event.features?.[0] as FireFeature | undefined;
            if (feature)
              new mapboxgl.Popup({ closeButton: true })
                .setLngLat(event.lngLat)
                .setText(popupText(feature.properties))
                .addTo(loadedMap);
          });
          loadedMap.on("mouseenter", "fire-perimeter-fill", () => {
            loadedMap.getCanvas().style.cursor = "pointer";
          });
          loadedMap.on("mouseleave", "fire-perimeter-fill", () => {
            loadedMap.getCanvas().style.cursor = "";
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
        <Flex
          background="slate.950/90"
          borderColor="slate.700"
          borderRadius="lg"
          borderWidth="1px"
          direction="column"
          gap="1"
          padding="4"
        >
          <Box as="h1" fontSize="lg" fontWeight="semibold">
            Active fire perimeters
          </Box>
          <Box as="p" color="slate.300" fontSize="sm">
            {status}
          </Box>
          {count !== undefined && (
            <Box as="strong" color="orange.400" fontSize="3xl">
              {count} active areas
            </Box>
          )}
          <Box as="small" color="slate.400" fontSize="xs">
            DeepFire · refreshes every minute
          </Box>
        </Flex>
      </Flex>
      <AnalyticsLayerControl
        activeLayer={activeLayer}
        data={analytics.data}
        selectedIndex={selectedIndex}
        status={analytics.status}
        onLayerChange={setActiveLayer}
      />
    </Box>
  );
}
