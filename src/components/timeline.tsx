"use client";

import { css } from "styled-system/css";
import { Box, Flex } from "styled-system/jsx";
import type { DayKind, WeatherSeries } from "@/lib/analytics-layer";

type Props = {
  series: WeatherSeries | null;
  dateIndex: number;
  status: "loading" | "error" | "ready";
  onDateIndexChange: (index: number) => void;
};

const KIND_LABEL: Record<DayKind, string> = {
  observed: "Observed",
  combined: "Part-observed",
  forecast: "Forecast",
};
const KIND_COLOUR: Record<DayKind, string> = {
  observed: "sky.300",
  combined: "amber.300",
  forecast: "orange.300",
};

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  });

/**
 * Date scrubber across the weather series. Only W and M move with the date --
 * fuel and consequence come from the static snapshot -- so the caption names
 * exactly what is being recomputed, and each day is marked observed or
 * forecast rather than being presented uniformly as data.
 */
export function Timeline({
  series,
  dateIndex,
  status,
  onDateIndexChange,
}: Props) {
  if (status === "error")
    return (
      <Flex
        aria-label="Timeline"
        as="section"
        background="slate.950/90"
        borderColor="slate.700"
        borderRadius="lg"
        borderWidth="1px"
        bottom="10"
        color="orange.300"
        direction="column"
        fontSize="xs"
        left="4"
        padding="3"
        pointerEvents="auto"
        position="absolute"
        zIndex="1"
      >
        Weather series unavailable — the timeline needs it. Static layers still
        work.
      </Flex>
    );
  if (status !== "ready" || !series || series.dates.length === 0)
    return (
      <Flex
        aria-label="Timeline"
        as="section"
        background="slate.950/90"
        borderColor="slate.700"
        borderRadius="lg"
        borderWidth="1px"
        bottom="10"
        color="slate.300"
        direction="column"
        fontSize="xs"
        left="4"
        padding="3"
        pointerEvents="auto"
        position="absolute"
        zIndex="1"
      >
        Loading weather series…
      </Flex>
    );

  const clamped = Math.min(Math.max(dateIndex, 0), series.dates.length - 1);
  const date = series.dates[clamped];
  const kind = series.regional[0]?.days[clamped]?.kind ?? "forecast";
  const offset = clamped - series.todayIndex;
  const relative =
    offset === 0
      ? "today"
      : offset < 0
        ? `${-offset} day${offset === -1 ? "" : "s"} ago`
        : `in ${offset} day${offset === 1 ? "" : "s"}`;

  return (
    <Flex
      aria-label="Timeline"
      as="section"
      background="slate.950/90"
      borderColor="slate.700"
      borderRadius="lg"
      borderWidth="1px"
      bottom="10"
      color="slate.50"
      direction="column"
      gap="2"
      left="4"
      maxWidth="lg"
      padding="3"
      pointerEvents="auto"
      position="absolute"
      right="4"
      zIndex="1"
    >
      <Flex align="baseline" gap="2" justify="space-between">
        <Box as="strong" fontSize="sm">
          {dayLabel(date)}
        </Box>
        <Box color={KIND_COLOUR[kind]} fontSize="xs">
          {KIND_LABEL[kind]} · {relative}
        </Box>
      </Flex>
      <input
        aria-label="Select date"
        aria-valuetext={`${dayLabel(date)}, ${KIND_LABEL[kind]}`}
        className={css({ accentColor: "orange.400", width: "full" })}
        max={series.dates.length - 1}
        min={0}
        step={1}
        type="range"
        value={clamped}
        onChange={(event) => onDateIndexChange(Number(event.target.value))}
      />
      <Flex aria-hidden="true" gap="0.5" height="1.5" width="full">
        {series.dates.map((entry, index) => {
          const entryKind = series.regional[0]?.days[index]?.kind ?? "forecast";
          return (
            <Box
              key={entry}
              background={
                index === clamped ? "slate.50" : KIND_COLOUR[entryKind]
              }
              borderRadius="sm"
              flex="1"
              opacity={index === clamped ? 1 : 0.45}
            />
          );
        })}
      </Flex>
      <Flex color="slate.400" fontSize="2xs" justify="space-between">
        <Box>{dayLabel(series.dates[0])}</Box>
        <Box>today</Box>
        <Box>{dayLabel(series.dates[series.dates.length - 1])}</Box>
      </Flex>
      <Box color="slate.300" fontSize="xs">
        Moving the date recomputes weather W and moisture M only. Vegetation
        fuel F and consequence C are fixed snapshot values.
      </Box>
    </Flex>
  );
}
