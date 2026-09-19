"use client";

import { Box, Flex } from "styled-system/jsx";
import {
  type AnalyticsLayerKey,
  fuelIndex,
  type PreparedCells,
} from "@/lib/analytics-layer";

type Props = {
  activeLayer: AnalyticsLayerKey;
  data: PreparedCells | null;
  selectedIndex: number | null;
  status: "loading" | "error" | "ready";
  onLayerChange: (layer: AnalyticsLayerKey) => void;
};
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const percent = (value: number) => `${Math.round(value * 100)}%`;

export function AnalyticsLayerControl({
  activeLayer,
  data,
  selectedIndex,
  status,
  onLayerChange,
}: Props) {
  const selected = data && selectedIndex !== null ? selectedIndex : null;
  const hasData = selected !== null && data !== null;
  const selectedData =
    hasData &&
    [
      data.tree[selected],
      data.shrub[selected],
      data.grass[selected],
      data.area_ha[selected],
      data.pop[selected],
      ...(data.assets[selected] ?? []),
    ].every(Number.isFinite);
  const fuel = hasData
    ? fuelIndex(data.tree[selected], data.shrub[selected], data.grass[selected])
    : 0;
  const nonVegetated = hasData && fuel === 0;
  const assetRows = selectedData
    ? data.asset_classes.flatMap((assetClass, index) =>
        data.assets[selected][index] > 0
          ? [[assetClass, data.assets[selected][index]] as const]
          : [],
      )
    : [];
  return (
    <Flex
      aria-label="Analytical layers"
      as="section"
      background="slate.950/90"
      borderColor="slate.700"
      borderRadius="lg"
      borderWidth="1px"
      color="slate.50"
      direction="column"
      gap="2"
      padding="3"
      pointerEvents="auto"
      position="absolute"
      right="4"
      top="4"
      width="80"
      zIndex="1"
    >
      <Box as="strong" fontSize="sm">
        Analytical layers
      </Box>
      <Flex gap="1">
        <Box
          as="button"
          aria-pressed={activeLayer === "fuel"}
          background={activeLayer === "fuel" ? "slate.700" : "slate.800"}
          borderRadius="md"
          flex="1"
          fontSize="xs"
          padding="2"
          onClick={() => onLayerChange("fuel")}
        >
          Vegetation fuel
        </Box>
        <Box
          as="button"
          aria-pressed={activeLayer === "population-assets"}
          background={
            activeLayer === "population-assets" ? "slate.700" : "slate.800"
          }
          borderRadius="md"
          flex="1"
          fontSize="xs"
          padding="2"
          onClick={() => onLayerChange("population-assets")}
        >
          Population & assets
        </Box>
      </Flex>
      <Box
        as="button"
        background="slate.800"
        borderRadius="md"
        fontSize="xs"
        padding="2"
        onClick={() => onLayerChange(null)}
      >
        Hide layer
      </Box>
      {status === "loading" && (
        <Box color="slate.300" fontSize="xs">
          Loading analytical snapshot…
        </Box>
      )}
      {status === "error" && (
        <Box color="orange.300" fontSize="xs">
          Analytical data is unavailable.
        </Box>
      )}
      {status === "ready" && activeLayer === "fuel" && (
        <>
          <Box color="slate.300" fontSize="xs">
            ESA WorldCover 2021 · land-cover proxy, not measured biomass.
          </Box>
          <Flex align="center" fontSize="xs" gap="2">
            <Box
              background="linear-gradient(to right, #1d4ed8, #f59e0b, #ef4444)"
              height="2"
              width="24"
            />
            <Box>Lower → higher vegetation fuel</Box>
          </Flex>
        </>
      )}
      {status === "ready" && activeLayer === "population-assets" && (
        <>
          <Box color="slate.300" fontSize="xs">
            Colour is Kontur population; a thin outline marks mapped OSM assets.
            Direct values appear after selection. Observational overview, not a
            risk score.
          </Box>
          <Flex align="center" fontSize="xs" gap="2">
            <Box
              background="linear-gradient(to right, #0ea5e9, #a3e635, #e11d48)"
              height="2"
              width="24"
            />
            <Box>Lower → higher population</Box>
          </Flex>
        </>
      )}
      {status === "ready" && activeLayer === null && (
        <Box color="slate.300" fontSize="xs">
          Layer hidden. Selected-cell facts remain available.
        </Box>
      )}
      {status === "ready" && (
        <Box color="slate.400" fontSize="xs">
          Neutral: No data · Non-vegetated land
        </Box>
      )}
      {status === "ready" && !hasData && (
        <Box color="slate.300" fontSize="xs">
          Select a hexagon to inspect its observed data.
        </Box>
      )}
      {hasData && !selectedData && (
        <Box color="slate.300" fontSize="xs">
          No data for this cell
        </Box>
      )}
      {selectedData && (
        <Flex
          borderColor="slate.700"
          borderTopWidth="1px"
          direction="column"
          fontSize="xs"
          gap="1"
          paddingTop="2"
        >
          <Box as="strong">
            {data.name[selected] ?? "Selected H3 cell"}
            {data.province[selected] ? ` · ${data.province[selected]}` : ""}
          </Box>
          {nonVegetated ? (
            <Box color="slate.300">Non-vegetated land</Box>
          ) : (
            <Box>
              {activeLayer === "fuel"
                ? `Fuel index: ${percent(fuel)}`
                : `Population: ${number.format(data.pop[selected])}`}
            </Box>
          )}
          <Box color="slate.300">
            Area {number.format(data.area_ha[selected])} ha · Tree{" "}
            {percent(data.tree[selected])} · Shrub{" "}
            {percent(data.shrub[selected])} · Grass{" "}
            {percent(data.grass[selected])}
          </Box>
          <Box>Population in cell: {number.format(data.pop[selected])}</Box>
          {assetRows.length > 0 && (
            <Box color="slate.300">
              OSM assets:{" "}
              {assetRows
                .map(([name, count]) => `${name.replaceAll("_", " ")} ${count}`)
                .join(" · ")}
            </Box>
          )}
        </Flex>
      )}
      <Box color="slate.500" fontSize="2xs">
        ESA WorldCover · Kontur Population · OpenStreetMap contributors ·
        GrootGuard snapshot, imported 19 Sep 2026 ·{" "}
        <a href="https://www.geoboundaries.org/">geoBoundaries</a>
      </Box>
    </Flex>
  );
}
