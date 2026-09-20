import "server-only";

const TOKEN_URL = "https://api.deepfire.co/v1/token";
const PERIMETERS_URL =
  "https://api.deepfire.co/ogc/features/v1/collections/deepfire:satellite-perimeters/items";
const SPAIN_BBOX = "-9.5,35.5,4.5,44.5";
type TokenResponse = { access_token: string; expires_in: number };
let cachedToken: { value: string; expiresAt: number } | undefined;

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now())
    return cachedToken.value;
  const clientId = process.env.DEEPFIRE_CLIENT_ID;
  const clientSecret = process.env.DEEPFIRE_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    throw new Error("DeepFire credentials are not configured.");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("DeepFire authentication failed.");
  const token = (await response.json()) as TokenResponse;
  cachedToken = {
    value: token.access_token,
    expiresAt: Date.now() + Math.max(token.expires_in - 30, 0) * 1000,
  };
  return cachedToken.value;
}

async function fetchPerimeters(
  filter: string,
  limit: number,
  revalidate?: number,
) {
  const url = new URL(PERIMETERS_URL);
  url.searchParams.set("bbox", SPAIN_BBOX);
  url.searchParams.set("filter-lang", "cql2-text");
  url.searchParams.set("filter", filter);
  url.searchParams.set("f", "application/geo+json");
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${await getAccessToken()}` },
    ...(revalidate === undefined
      ? { cache: "no-store" as const }
      : { next: { revalidate } }),
  });
  if (!response.ok) throw new Error("DeepFire perimeters request failed.");
  return response.json();
}

export async function getActivePerimeters() {
  return fetchPerimeters("active = true", 1000);
}

/**
 * The season's burnt footprint, from 1 June of the most recent fire season.
 *
 * DeepFire's Spain archive begins 2026-06-10; earlier seasons return nothing,
 * so this deliberately covers one season rather than pretending to be a
 * multi-year history.
 */
const SEASON_START_MONTH = 5; // June, zero-based.
const SEASON_LIMIT = 5000;
const COORDINATE_PRECISION = 4; // ~11 m, enough for a country-scale map.
const SEASON_REVALIDATE_SECONDS = 21_600;

type Ring = number[];
type GeoJsonPosition = number[] | Ring[] | Ring[][];

/** Round coordinates in place-shape, cutting payload without visible loss. */
function roundCoordinates(value: GeoJsonPosition): GeoJsonPosition {
  if (Array.isArray(value) && value.length >= 2 && typeof value[0] === "number")
    return (value as number[]).map(
      (part) =>
        Math.round(part * 10 ** COORDINATE_PRECISION) /
        10 ** COORDINATE_PRECISION,
    );
  return (value as Ring[]).map((part) =>
    roundCoordinates(part as GeoJsonPosition),
  ) as GeoJsonPosition;
}

type RawFeature = {
  geometry: { type: string; coordinates: GeoJsonPosition };
  properties: {
    observed_watermark?: string;
    area_m2?: number;
    n_hotspots?: number;
    active?: boolean;
  };
};

export function seasonRange(now: Date) {
  const year =
    now.getUTCMonth() < SEASON_START_MONTH
      ? now.getUTCFullYear() - 1
      : now.getUTCFullYear();
  return {
    year,
    from: `${year}-06-01T00:00:00Z`,
    to: new Date(
      Date.UTC(year + 1, 0, 1) < now.getTime()
        ? Date.UTC(year + 1, 0, 1)
        : now.getTime(),
    ).toISOString(),
  };
}

export async function getSeasonPerimeters() {
  const { year, from, to } = seasonRange(new Date());
  const collection = (await fetchPerimeters(
    `observed_watermark >= TIMESTAMP('${from}') AND observed_watermark <= TIMESTAMP('${to}')`,
    SEASON_LIMIT,
    SEASON_REVALIDATE_SECONDS,
  )) as { features?: RawFeature[] };

  const features = (collection.features ?? []).map((feature) => ({
    type: "Feature" as const,
    geometry: {
      type: feature.geometry.type,
      coordinates: roundCoordinates(feature.geometry.coordinates),
    },
    properties: {
      // Month index within the season drives the month filter on the client.
      month: Number(feature.properties.observed_watermark?.slice(5, 7) ?? 0),
      observed: feature.properties.observed_watermark?.slice(0, 10) ?? null,
      area_ha: Math.round((feature.properties.area_m2 ?? 0) / 10_000),
      n_hotspots: feature.properties.n_hotspots ?? 0,
      active: feature.properties.active ? 1 : 0,
    },
  }));

  const months = [
    ...new Set(features.map((feature) => feature.properties.month)),
  ]
    .filter(Boolean)
    .sort((left, right) => left - right);

  return {
    type: "FeatureCollection" as const,
    season: year,
    months,
    totalAreaHa: features.reduce(
      (sum, feature) => sum + feature.properties.area_ha,
      0,
    ),
    features,
  };
}
