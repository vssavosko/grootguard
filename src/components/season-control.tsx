"use client";

import { Box, Flex } from "styled-system/jsx";
import type { SeasonCollection } from "@/components/world-map";

type Props = {
  season: SeasonCollection | null;
  status: "loading" | "error" | "ready";
  visible: boolean;
  onToggle: (visible: boolean) => void;
};

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * Summary of the season's burnt footprint.
 *
 * The whole season is drawn at once rather than behind a month filter: the
 * footprint is the context for today's fires.
 *
 * The parent status card is `pointer-events: none` so the map stays draggable
 * under it, so anything interactive here has to opt back in explicitly.
 */
export function SeasonControl({ season, status, visible, onToggle }: Props) {
  if (status === "error")
    return (
      <Box color="orange.300" fontSize="xs">
        Season fire history is unavailable.
      </Box>
    );
  if (status !== "ready" || !season)
    return (
      <Box color="slate.400" fontSize="xs">
        Loading season history…
      </Box>
    );

  return (
    <Flex
      borderColor="slate.700"
      borderTopWidth="1px"
      direction="column"
      gap="1"
      paddingTop="2"
    >
      {/* The whole row toggles: a two-word "Hide" link was too small a target. */}
      <Flex
        as="button"
        align="center"
        aria-pressed={visible}
        borderRadius="md"
        cursor="pointer"
        gap="2"
        justify="space-between"
        marginX="-1"
        paddingX="1"
        paddingY="1"
        pointerEvents="auto"
        title="Show or hide the burnt-area layer"
        width="full"
        _hover={{ background: "slate.800" }}
        onClick={() => onToggle(!visible)}
      >
        <Flex align="center" gap="2">
          <Box
            background={visible ? "#4a1d12" : "transparent"}
            borderColor="#8a3a1e"
            borderRadius="sm"
            borderWidth="1px"
            height="3"
            width="3"
          />
          <Box as="strong" fontSize="xs">
            Burnt in {season.season}
          </Box>
        </Flex>
        <Box color={visible ? "orange.300" : "slate.400"} fontSize="2xs">
          {visible ? "Hide" : "Show"}
        </Box>
      </Flex>
      <Box color="slate.400" fontSize="2xs">
        {number.format(season.features.length)} perimeters ·{" "}
        {number.format(Math.round(season.totalAreaHa / 100))} km²
      </Box>
      <Box color="slate.500" fontSize="2xs">
        Seasonal satellite footprint. Archive starts 10 Jun 2026.
      </Box>
    </Flex>
  );
}
