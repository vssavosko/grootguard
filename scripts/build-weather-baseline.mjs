/**
 * Build the committed z-score baseline for the fire-weather factor W.
 *
 *   node scripts/build-weather-baseline.mjs [--years 3] [--out public/data/weather-baseline.json]
 *
 * Why this exists
 * ---------------
 * W is `clamp(0.6 + 0.25 * (z1 + z2 + z3 + z4), 0.6, 1.6)`. The floor is the
 * same value as the unweighted mean, so whenever the z-sum is negative -- about
 * half of all days against any zero-centred baseline -- W clamps flat onto 0.6.
 * Measured against a recent-days baseline the z-sum is zero-centred almost
 * exactly, which pins ~70% of point-days to the floor and paints the country a
 * single colour.
 *
 * The factor only carries signal when the baseline spans a full annual cycle:
 * fire season then sits well above the yearly mean (hotter, drier, longer since
 * rain), the z-sum goes positive, and W spreads across its range.
 *
 * Source
 * ------
 * Open-Meteo's ERA5 archive, which the original design spec named. It is free,
 * needs no key, and returns whole years in one request per point -- so building
 * this costs nothing against the Visual Crossing daily record budget that the
 * live series spends.
 *
 * Caveat: the baseline provider is not the series provider. ERA5 reanalysis and
 * Visual Crossing's observation blend can differ systematically, which biases
 * the z-scores somewhat. Recording per-variable means here makes that auditable.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { cellToLatLng } from "h3-js";

const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const REGIONAL_POINT_COUNT = 10;
const RAIN_THRESHOLD_MM = 1;
/** Open-Meteo names, in the order the W factor consumes them. */
const VARIABLES = [
  "temperature_2m_max",
  "relative_humidity_2m_mean",
  "wind_speed_10m_max",
  "precipitation_sum",
];

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};
const out = argument("out", "public/data/weather-baseline.json");
const years = Number(argument("years", "3"));
assert(
  Number.isInteger(years) && years > 0,
  "--years must be a positive integer",
);

const cells = JSON.parse(
  await readFile(
    new URL("../public/data/grootguard-cells.json", import.meta.url),
    "utf8",
  ),
);
const coordinates = cells.weather_points.map((point) => {
  const [latitude, longitude] = cellToLatLng(point);
  return { latitude, longitude };
});

/**
 * Same farthest-point selection the server uses, so baseline entry N lines up
 * with regional series N.
 */
function regionalPointIndexes(points) {
  const indexes = [0];
  while (indexes.length < Math.min(REGIONAL_POINT_COUNT, points.length)) {
    let next = -1;
    let farthest = -1;
    for (let index = 0; index < points.length; index++) {
      if (indexes.includes(index)) continue;
      const distance = Math.min(
        ...indexes.map((selected) => {
          const latitude = points[index].latitude - points[selected].latitude;
          const longitude =
            points[index].longitude - points[selected].longitude;
          return latitude ** 2 + longitude ** 2;
        }),
      );
      if (distance > farthest) {
        farthest = distance;
        next = index;
      }
    }
    indexes.push(next);
  }
  return indexes;
}

const regional = regionalPointIndexes(coordinates).map(
  (index) => coordinates[index],
);
const lastFullYear = new Date().getUTCFullYear() - 1;
const firstYear = lastFullYear - years + 1;

const distribution = (values) => {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { mean: 0, standardDeviation: 0 };
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance =
    finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
  return { mean, standardDeviation: Math.sqrt(variance) };
};

async function fetchArchive(point) {
  const url = new URL(ARCHIVE_URL);
  url.searchParams.set("latitude", String(point.latitude));
  url.searchParams.set("longitude", String(point.longitude));
  url.searchParams.set("start_date", `${firstYear}-01-01`);
  url.searchParams.set("end_date", `${lastFullYear}-12-31`);
  url.searchParams.set("daily", VARIABLES.join(","));
  url.searchParams.set("timezone", "UTC");
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Open-Meteo request failed (${response.status}).`);
  const payload = await response.json();
  assert(payload.daily?.time?.length, "Open-Meteo returned no daily records");
  return payload.daily;
}

/** Days since the last day with >= 1 mm of rain, across contiguous archive days. */
function daysSinceRainSeries(precipitation) {
  let since = null;
  return precipitation.map((value) => {
    if (Number.isFinite(value) && value >= RAIN_THRESHOLD_MM) {
      since = 0;
      return 0;
    }
    since = since === null ? null : since + 1;
    return since;
  });
}

const points = [];
for (const point of regional) {
  const daily = await fetchArchive(point);
  const sinceRain = daysSinceRainSeries(daily.precipitation_sum);
  const baseline = {
    maxTemperature: distribution(daily.temperature_2m_max),
    humidity: distribution(daily.relative_humidity_2m_mean),
    maxWind: distribution(daily.wind_speed_10m_max),
    daysSinceRain: distribution(sinceRain),
  };
  points.push({ ...point, days: daily.time.length, baseline });
  console.log(
    `point ${points.length}/${regional.length} (${point.latitude.toFixed(2)}, ${point.longitude.toFixed(2)}): ${daily.time.length} days, mean tempmax ${baseline.maxTemperature.mean.toFixed(1)} °C`,
  );
}

await writeFile(
  out,
  `${JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      years: [firstYear, lastFullYear],
      source: "Open-Meteo ERA5 archive",
      variables: VARIABLES,
      complete: points.length === regional.length,
      points,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `\nWrote ${out}: ${points.length} points, ${firstYear}-${lastFullYear}.`,
);
