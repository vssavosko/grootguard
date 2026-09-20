"use client";

import { Box, Flex } from "styled-system/jsx";
import type { DynamicCells, PreparedCells } from "@/lib/analytics-layer";

type Props = {
  data: PreparedCells | null;
  dynamic: DynamicCells | null;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
};

const TOP_COUNT = 10;
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function changeLabel(change: number | null) {
  if (change === null || change === 0) return { text: "—", tone: "slate.400" };
  return change > 0
    ? { text: `▲${change}`, tone: "orange.300" }
    : { text: `▼${-change}`, tone: "sky.300" };
}

/**
 * Highest-priority cells for the selected date, with movement against the same
 * cell one week earlier. Cells without a usable W or M are absent rather than
 * ranked at zero.
 */
export function TopZones({ data, dynamic, selectedIndex, onSelect }: Props) {
  if (!data || !dynamic) return null;
  const ranked = dynamic.priority
    .map((value, index) => ({ value, index }))
    .filter(
      (entry): entry is { value: number; index: number } =>
        entry.value !== null && Number.isFinite(entry.value),
    )
    .sort((left, right) => right.value - left.value || left.index - right.index)
    .slice(0, TOP_COUNT);

  if (ranked.length === 0) return null;

  return (
    <Flex
      aria-label="Top zones"
      as="section"
      borderColor="slate.700"
      borderTopWidth="1px"
      color="slate.50"
      direction="column"
      gap="1"
      paddingTop="2"
    >
      <Box as="strong" fontSize="sm">
        Top zones
      </Box>
      <Box color="slate.400" fontSize="2xs">
        Prevention priority for the selected date · change vs one week earlier
      </Box>
      {ranked.map((entry, position) => {
        const change = changeLabel(dynamic.rankChange[entry.index]);
        // Municipality first, province second: the rank is only actionable if
        // you can tell which municipality owns the cell.
        const municipality = data.name[entry.index];
        const province = data.province[entry.index];
        const place = municipality ?? province ?? "Unnamed cell";
        return (
          <Flex
            key={data.cells[entry.index]}
            as="button"
            align="center"
            aria-pressed={selectedIndex === entry.index}
            background={
              selectedIndex === entry.index ? "slate.700" : "transparent"
            }
            borderRadius="md"
            fontSize="xs"
            gap="2"
            padding="1"
            textAlign="left"
            width="full"
            onClick={() => onSelect(entry.index)}
          >
            <Box color="slate.400" width="4">
              {position + 1}
            </Box>
            <Box color={change.tone} width="8">
              {change.text}
            </Box>
            <Flex direction="column" flex="1" overflow="hidden">
              <Box
                overflow="hidden"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
              >
                {place}
              </Box>
              {municipality && province && (
                <Box color="slate.500" fontSize="2xs">
                  {province}
                </Box>
              )}
            </Flex>
            <Box color="slate.300">{entry.value.toFixed(1)}</Box>
            <Box color="slate.500" width="12" textAlign="right">
              {number.format(data.pop[entry.index])}
            </Box>
          </Flex>
        );
      })}
    </Flex>
  );
}
