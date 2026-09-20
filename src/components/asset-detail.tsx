"use client";

import { Box, Flex } from "styled-system/jsx";
import type { PreparedCells } from "@/lib/analytics-layer";

type Props = {
  data: PreparedCells;
  index: number;
};

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Readable names for the snapshot's OSM asset classes. */
const ASSET_LABEL: Record<string, string> = {
  hospital: "Hospitals",
  power_plant: "Power plants",
  substation: "Substations",
  school: "Schools",
  industrial: "Industrial sites",
  rail_motorway: "Rail & motorway",
};
/** Listed care-first, so life-safety assets read before infrastructure. */
const ASSET_ORDER = [
  "hospital",
  "school",
  "power_plant",
  "substation",
  "industrial",
  "rail_motorway",
];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Flex gap="2" justify="space-between">
      <Box color="slate.300">{label}</Box>
      <Box>{value}</Box>
    </Flex>
  );
}

/**
 * People and mapped assets for one cell.
 *
 * These are the inputs behind the consequence term C, so they are listed
 * individually instead of collapsed into one line: a cell holding a hospital
 * is a different prevention case from one holding a motorway, even at equal
 * asset counts. Counts are mapped OpenStreetMap features, not a census.
 */
export function AssetDetail({ data, index }: Props) {
  const counts = data.asset_classes
    .map((assetClass, position) => ({
      assetClass,
      count: data.assets[index]?.[position] ?? 0,
    }))
    .filter((entry) => entry.count > 0)
    .sort(
      (left, right) =>
        ASSET_ORDER.indexOf(left.assetClass) -
        ASSET_ORDER.indexOf(right.assetClass),
    );
  const topAssetName = data.top_asset_name[index];
  const topAssetClass = data.asset_classes[data.top_asset[index]];
  const exposed = data.pop_exposed[index];
  const nearby = data.pop10km[index];

  return (
    <Flex
      borderColor="slate.800"
      borderTopWidth="1px"
      direction="column"
      gap="1"
      paddingTop="1"
    >
      <Box as="strong" color="slate.200">
        People
      </Box>
      <Row label="In this cell" value={number.format(data.pop[index])} />
      {Number.isFinite(exposed) && (
        <Row label="Exposed to burnable land" value={number.format(exposed)} />
      )}
      {Number.isFinite(nearby) && (
        <Row label="Within 10 km" value={number.format(nearby)} />
      )}

      <Box as="strong" color="slate.200" paddingTop="1">
        Assets
      </Box>
      {counts.length === 0 ? (
        <Box color="slate.400">No mapped OSM assets in this cell.</Box>
      ) : (
        <>
          {counts.map(({ assetClass, count }) => (
            <Row
              key={assetClass}
              label={ASSET_LABEL[assetClass] ?? assetClass.replace("_", " ")}
              value={number.format(count)}
            />
          ))}
          {topAssetName && (
            <Box color="slate.400" fontSize="2xs">
              Largest: {topAssetName}
              {topAssetClass
                ? ` · ${(ASSET_LABEL[topAssetClass] ?? topAssetClass).replace(/s$/, "").toLowerCase()}`
                : ""}
            </Box>
          )}
        </>
      )}
      <Box color="slate.500" fontSize="2xs">
        Counts are mapped OpenStreetMap features, not a complete register.
      </Box>
    </Flex>
  );
}
