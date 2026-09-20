"use client";

import { Box, Flex } from "styled-system/jsx";
import { AssetDetail } from "@/components/asset-detail";
import { TopZones } from "@/components/top-zones";
import {
  type AnalyticsLayerKey,
  type DynamicCells,
  fuelIndex,
  type PointDay,
  type PreparedCells,
  RANK_COMPARISON_DAYS,
  type WeatherSeries,
} from "@/lib/analytics-layer";

type Props = {
  activeLayer: AnalyticsLayerKey;
  data: PreparedCells | null;
  dateIndex: number;
  dynamic: DynamicCells | null;
  selectedIndex: number | null;
  series: WeatherSeries | null;
  status: "loading" | "error" | "ready";
  weatherStatus: "loading" | "error" | "ready";
  onLayerChange: (layer: AnalyticsLayerKey) => void;
  onSelectCell: (index: number) => void;
};
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const percent = (value: number) => `${Math.round(value * 100)}%`;
const decimal = (value: number | null | undefined, digits = 2) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "—";

const DYNAMIC_LAYERS: Array<{ key: AnalyticsLayerKey; label: string }> = [
  { key: "priority", label: "Priority" },
  { key: "weather", label: "Weather" },
  { key: "moisture", label: "Rainfall" },
];

/**
 * Panda extracts styles at build time, so a gradient built from a prop cannot
 * be a style prop — it would emit no CSS. The swatch uses an inline style.
 */
function Ramp({ colours, children }: { colours: string; children: string }) {
  return (
    <Flex align="center" fontSize="xs" gap="2">
      <Box
        flexShrink="0"
        height="2"
        style={{ backgroundImage: `linear-gradient(to right, ${colours})` }}
        width="24"
      />
      <Box>{children}</Box>
    </Flex>
  );
}

export function AnalyticsLayerControl({
  activeLayer,
  data,
  dateIndex,
  dynamic,
  selectedIndex,
  series,
  status,
  weatherStatus,
  onLayerChange,
  onSelectCell,
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
  const day: PointDay | undefined =
    hasData && series
      ? series.regional[series.points[data.wpt[selected]]?.regional ?? -1]
          ?.days[dateIndex]
      : undefined;
  const rankChange = hasData ? dynamic?.rankChange[selected] : undefined;
  const cutoff = series?.dates[dateIndex];

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
      maxHeight="calc(100dvh - 2rem)"
      overflowY="auto"
      padding="2.5"
      pointerEvents="auto"
      position="absolute"
      right="4"
      top="4"
      width="72"
      zIndex="1"
    >
      <Box as="strong" fontSize="sm">
        Analytical layers
      </Box>
      <Flex gap="1">
        {DYNAMIC_LAYERS.map(({ key, label }) => (
          <Box
            key={label}
            as="button"
            aria-disabled={weatherStatus !== "ready"}
            aria-pressed={activeLayer === key}
            background={activeLayer === key ? "slate.700" : "slate.800"}
            borderRadius="md"
            flex="1"
            fontSize="xs"
            padding="2"
            onClick={() => {
              if (weatherStatus === "ready") onLayerChange(key);
            }}
          >
            {label}
          </Box>
        ))}
      </Flex>
      <Flex gap="1">
        <Box
          as="button"
          aria-pressed={activeLayer === "soil-water"}
          background={activeLayer === "soil-water" ? "slate.700" : "slate.800"}
          borderRadius="md"
          flex="1"
          fontSize="xs"
          padding="2"
          onClick={() => {
            if (weatherStatus === "ready") onLayerChange("soil-water");
          }}
        >
          Soil water
        </Box>
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
          Vegetation
        </Box>
      </Flex>
      <Flex gap="1">
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
          People & assets
        </Box>
        <Box
          as="button"
          background="slate.800"
          borderRadius="md"
          flex="1"
          fontSize="xs"
          padding="2"
          onClick={() => onLayerChange(null)}
        >
          Hide layer
        </Box>
      </Flex>
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
      {weatherStatus === "loading" && (
        <Box color="slate.300" fontSize="xs">
          Loading weather series…
        </Box>
      )}
      {weatherStatus === "error" && (
        <Box color="orange.300" fontSize="xs">
          Weather series is temporarily unavailable. Static layers still work.
        </Box>
      )}
      {series?.fixture && (
        <Box
          background="amber.950"
          borderColor="amber.600"
          borderRadius="md"
          borderWidth="1px"
          color="amber.200"
          fontSize="2xs"
          padding="1.5"
        >
          Sample data — this series comes from a recorded development fixture,
          not the live provider.
        </Box>
      )}
      {status === "ready" && activeLayer === "fuel" && (
        <>
          <Box color="slate.300" fontSize="xs">
            ESA WorldCover 2021 · land-cover proxy, not measured biomass. Fixed
            — does not move with the timeline.
          </Box>
          <Ramp colours="#1d4ed8, #f59e0b, #ef4444">
            Lower → higher vegetation fuel
          </Ramp>
        </>
      )}
      {status === "ready" && activeLayer === "population-assets" && (
        <>
          <Box color="slate.300" fontSize="xs">
            Kontur population; outline marks mapped OSM assets. Observational,
            not a risk score.
          </Box>
          <Ramp colours="#0ea5e9, #a3e635, #e11d48">
            Lower → higher population
          </Ramp>
        </>
      )}
      {weatherStatus === "ready" && activeLayer === "priority" && (
        <>
          <Box color="slate.300" fontSize="xs">
            F × W × (0.4 + 0.6(1−M)) × C. Model assumption — not an official
            warning or ignition forecast.
          </Box>
          <Ramp colours="#1d4ed8, #facc15, #fb923c, #f97316">
            Lower → higher priority
          </Ramp>
          <Box color="slate.400" fontSize="2xs">
            Rank change compares {cutoff} with {RANK_COMPARISON_DAYS} days
            earlier.
          </Box>
        </>
      )}
      {weatherStatus === "ready" && activeLayer === "weather" && (
        <>
          <Box color="slate.300" fontSize="xs">
            Factor W (0.6–1.6) from temperature, humidity, wind and days since
            rain at 10 regional points.
          </Box>
          <Ramp colours="#1d4ed8, #38bdf8, #facc15, #f97316, #dc2626">
            Milder → harsher fire weather
          </Ramp>
          <Box
            color={
              series?.baselineSource === "climatology"
                ? "slate.400"
                : "orange.300"
            }
            fontSize="2xs"
          >
            {series?.baselineSource === "climatology"
              ? "Z-scores use the committed multi-year baseline."
              : "No multi-year baseline yet: z-scores fall back to recent observed days, which drives W onto its 0.6 floor. Run scripts/build-weather-baseline.mjs for a usable W."}
          </Box>
        </>
      )}
      {weatherStatus === "ready" && activeLayer === "moisture" && (
        <>
          <Box color="slate.300" fontSize="xs">
            Factor M = 30-day rainfall ÷ 60 mm, clamped 0–1. Forecast rain moves
            it on future dates.
          </Box>
          <Ramp colours="#dc2626, #facc15, #38bdf8, #2563eb">
            Drier → wetter 30-day total
          </Ramp>
        </>
      )}
      {weatherStatus === "ready" && activeLayer === "soil-water" && (
        <>
          <Box color="slate.300" fontSize="xs">
            Copernicus SWI001 · latest daily pass, 10-day composite where it has
            no data. 0.1° / 12.5 km.
          </Box>
          <Ramp colours="#dc2626, #facc15, #38bdf8, #2563eb">
            Lower → higher soil water
          </Ramp>
          <Box color="slate.400" fontSize="2xs">
            Observed {series?.moistureObservedAt} — observation only, so it does
            not move with the timeline and does not enter the priority formula.
          </Box>
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
      {activeLayer === "priority" && (
        <TopZones
          data={data}
          dynamic={dynamic}
          selectedIndex={selectedIndex}
          onSelect={onSelectCell}
        />
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
            <Box>Fuel index: {percent(fuel)}</Box>
          )}
          <Box color="slate.300">
            Area {number.format(data.area_ha[selected])} ha · Tree{" "}
            {percent(data.tree[selected])} · Shrub{" "}
            {percent(data.shrub[selected])} · Grass{" "}
            {percent(data.grass[selected])}
          </Box>
          <AssetDetail data={data} index={selected} />
          {weatherStatus === "ready" && (
            <Flex
              borderColor="slate.800"
              borderTopWidth="1px"
              direction="column"
              gap="0.5"
              paddingTop="1"
            >
              <Box color="slate.400" fontSize="2xs">
                {cutoff} · {day?.kind ?? "no data"}
              </Box>
              <Box>
                F {decimal(fuel)} · W {decimal(day?.weather)} · M{" "}
                {decimal(day?.moisture)} · C {decimal(data.C[selected])}
              </Box>
              <Box>
                Priority {decimal(dynamic?.priority[selected] ?? null, 1)}
                {typeof rankChange === "number" && rankChange !== 0
                  ? ` · ${rankChange > 0 ? "▲" : "▼"}${Math.abs(rankChange)} vs ${RANK_COMPARISON_DAYS}d earlier`
                  : ""}
              </Box>
              <Box color="slate.300">
                {decimal(day?.maxTemperature, 1)} °C ·{" "}
                {decimal(day?.humidity, 0)}% RH · {decimal(day?.maxWind, 0)}{" "}
                km/h · {decimal(day?.daysSinceRain, 0)} d since rain ·{" "}
                {decimal(day?.precipitation30Day, 0)} mm/30d
              </Box>
            </Flex>
          )}
        </Flex>
      )}
      <Box color="slate.500" fontSize="2xs">
        ESA WorldCover · Kontur Population · OpenStreetMap contributors · Visual
        Crossing · Copernicus CLMS · GrootGuard snapshot, imported 19 Sep 2026 ·{" "}
        <a href="https://www.geoboundaries.org/">geoBoundaries</a>
      </Box>
    </Flex>
  );
}
