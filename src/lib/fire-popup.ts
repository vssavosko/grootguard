import { latLngToCell } from "h3-js";
import type { PreparedCells } from "@/lib/analytics-layer";

/** Resolution of the committed GrootGuard cell grid. */
const H3_RESOLUTION = 6;

/** Union of the live-perimeter and season-history property shapes. */
export type FirePopupProperties = {
  observed_watermark?: string;
  observed?: string;
  area_m2?: number;
  area_ha?: number;
  n_hotspots?: number;
  active?: boolean | number;
};
/** Snapshot the hover handler reads; the map effect runs once and can't close over state. */
export type AnalyticsSnapshot = {
  data: PreparedCells | null;
  lookup: Map<string, number> | null;
};

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );

/**
 * Hover card for a fire.
 *
 * DeepFire reports burnt extent and hotspot counts, not damage in any monetary
 * or casualty sense. To give that extent some meaning, the H3 cell under the
 * cursor contributes its municipality and population -- stated as what is in
 * the area, never as a claim about what was lost.
 */
export function firePopupHtml(
  properties: FirePopupProperties,
  latitude: number,
  longitude: number,
  analytics: AnalyticsSnapshot,
) {
  const timestamp = properties.observed_watermark ?? properties.observed;
  const observed = timestamp
    ? new Date(timestamp).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Unknown";
  const hectares =
    properties.area_ha ??
    (properties.area_m2 ? properties.area_m2 / 10_000 : undefined);
  const area =
    hectares === undefined
      ? "Unknown"
      : `${integer.format(Math.round(hectares))} ha · ${(hectares / 100).toFixed(2)} km²`;
  const isActive = properties.active === true || properties.active === 1;

  const rows = [
    ["Observed", observed],
    ["Burnt extent", area],
    ["Hotspots", integer.format(Number(properties.n_hotspots ?? 0))],
  ];

  const { data, lookup } = analytics;
  if (data && lookup) {
    const index = lookup.get(latLngToCell(latitude, longitude, H3_RESOLUTION));
    if (index !== undefined) {
      const place = [data.name[index], data.province[index]]
        .filter(Boolean)
        .join(" · ");
      if (place) rows.push(["Location", place]);
      if (Number.isFinite(data.pop[index]))
        rows.push(["People in cell", integer.format(data.pop[index])]);
      const assets = data.asset_classes
        .map((assetClass, position) => ({
          assetClass,
          count: data.assets[index]?.[position] ?? 0,
        }))
        .filter((entry) => entry.count > 0)
        .map((entry) => `${entry.assetClass.replace("_", " ")} ${entry.count}`);
      if (assets.length > 0) rows.push(["Assets in cell", assets.join(", ")]);
    }
  }

  return `<div style="font:12px/1.45 system-ui,sans-serif;color:#0f172a">
    <div style="font-weight:600;margin-bottom:4px">
      ${isActive ? "🔥 Active fire" : "Burnt area"}
    </div>
    ${rows
      .map(
        ([label, value]) =>
          `<div style="display:flex;gap:8px;justify-content:space-between"><span style="color:#64748b">${label}</span><span style="text-align:right">${escapeHtml(String(value))}</span></div>`,
      )
      .join("")}
    <div style="margin-top:5px;color:#64748b;font-size:10px">
      Satellite estimate of burnt extent — not an official boundary, and not a
      damage assessment.
    </div>
  </div>`;
}
