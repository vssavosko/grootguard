import { cellToBoundary, latLngToCell, polygonToCells } from "h3-js";

type Position = [number, number];
type FireGeometry =
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

export type FireCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: FireGeometry;
    properties: Record<string, unknown>;
  }>;
};

function isFireGeometry(geometry: unknown): geometry is FireGeometry {
  const typed = geometry as { type?: unknown; coordinates?: unknown };
  return (
    (typed.type === "Polygon" || typed.type === "MultiPolygon") &&
    Array.isArray(typed.coordinates)
  );
}

export function toFireCoverage(
  collection: { features: unknown[] },
  resolution: number,
) {
  const coverage = new Set<string>();
  for (const feature of collection.features) {
    const geometry = (feature as { geometry?: unknown }).geometry;
    if (!isFireGeometry(geometry)) continue;
    const polygons =
      geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const rings of polygons) {
      for (const cell of polygonToCells(rings, resolution, true))
        coverage.add(cell);
      const outerRing = rings[0];
      if (!outerRing?.length) continue;
      const vertices =
        outerRing.length > 1 ? outerRing.slice(0, -1) : outerRing;
      if (!vertices.length) continue;
      const [longitude, latitude] = vertices.reduce(
        ([lng, lat], [nextLng, nextLat]) => [
          lng + nextLng / vertices.length,
          lat + nextLat / vertices.length,
        ],
        [0, 0],
      );
      coverage.add(latLngToCell(latitude, longitude, resolution));
    }
  }
  return {
    type: "FeatureCollection" as const,
    features: [...coverage].map((cell) => ({
      type: "Feature" as const,
      geometry: {
        type: "Polygon" as const,
        coordinates: [cellToBoundary(cell, true)],
      },
      properties: { cell },
    })),
  };
}
