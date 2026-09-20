/**
 * Build a recorded weather series for offline development and CI.
 *
 * The provider bills per daily record, so a full live refresh is expensive and
 * capped per day. This script turns one real daily payload into a complete
 * fixture so the timeline can be exercised without spending that budget.
 *
 *   node scripts/build-weather-fixture.mjs --from <daily.json> [--out <path>]
 *
 * `--from` is a Visual Crossing timeline response covering the lead-in window
 * (37 days before today through 14 days after). Its observations are real; the
 * per-point spread across the other nine regional points is a deterministic
 * synthetic offset, so the result is labelled a fixture and must never be
 * presented as live data.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { cellToLatLng } from "h3-js";
import ts from "typescript";

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};

const from = argument("from");
const out = argument("out", "public/data/weather-fixture.json");
assert(from, "Pass --from <visual-crossing-daily.json>");

const source = await readFile(
  new URL("../src/lib/weather-model.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { moistureFactor, weatherFactor } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const PAST_DAYS = 7;
const MOISTURE_WINDOW_DAYS = 30;
const RAIN_THRESHOLD_MM = 1;
const REGIONAL_POINT_COUNT = 10;

const distribution = (values) => {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { mean: 0, standardDeviation: 0 };
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance =
    finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
  return { mean, standardDeviation: Math.sqrt(variance) };
};

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

const nearestRegionalIndex = (point, regional) =>
  regional.reduce(
    (closest, candidate, index) => {
      const latitude = point.latitude - candidate.latitude;
      const longitude = point.longitude - candidate.longitude;
      const distance = latitude ** 2 + longitude ** 2;
      return distance < closest.distance ? { index, distance } : closest;
    },
    { index: 0, distance: Number.POSITIVE_INFINITY },
  ).index;

let climatology = null;
try {
  climatology = JSON.parse(
    await readFile(
      new URL("../public/data/weather-baseline.json", import.meta.url),
      "utf8",
    ),
  );
  console.log(
    `Using committed climatology baseline (${climatology.points.length} points).`,
  );
} catch {
  console.warn("No weather-baseline.json found: W will clamp onto its floor.");
}

const payload = JSON.parse(await readFile(from, "utf8"));
const baseDays = payload.days;
assert(
  Array.isArray(baseDays) && baseDays.length > MOISTURE_WINDOW_DAYS,
  "Source payload needs more than 30 daily records",
);

const regionalIndexes = regionalPointIndexes(coordinates);
const regionalCoordinates = regionalIndexes.map((index) => coordinates[index]);
const today = baseDays[baseDays.length - 15]?.datetime;
assert(today, "Could not locate today in the source payload");
const firstShown = baseDays[baseDays.length - 15 - PAST_DAYS]?.datetime;

const kindFromSource = (value) =>
  value === "obs" ? "observed" : value === "fcst" ? "forecast" : "combined";

const regional = regionalCoordinates.map((point, pointIndex) => {
  // Deterministic synthetic spread: cooler and wetter toward the north-west.
  const temperatureOffset = (40.4 - point.latitude) * 1.4;
  const precipitationScale = 1 + (point.longitude + 3.7) * 0.06;

  const days = baseDays.map((day) => ({
    datetime: day.datetime,
    source: day.source,
    tempmax:
      typeof day.tempmax === "number" ? day.tempmax + temperatureOffset : null,
    humidity: typeof day.humidity === "number" ? day.humidity : null,
    windspeed: typeof day.windspeed === "number" ? day.windspeed : null,
    precip:
      typeof day.precip === "number"
        ? Math.max(0, day.precip * precipitationScale)
        : null,
  }));

  let since = null;
  const sinceRain = days.map((day) => {
    if (day.precip !== null && day.precip >= RAIN_THRESHOLD_MM) {
      since = 0;
      return 0;
    }
    since = since === null ? null : since + 1;
    return since;
  });
  const precipitation30 = days.map((_, index) => {
    if (index + 1 < MOISTURE_WINDOW_DAYS) return null;
    const window = days.slice(index + 1 - MOISTURE_WINDOW_DAYS, index + 1);
    if (window.some((day) => day.precip === null)) return null;
    return window.reduce((sum, day) => sum + day.precip, 0);
  });

  const conditions = days.map((day, index) => ({
    maxTemperature: day.tempmax ?? undefined,
    humidity: day.humidity ?? undefined,
    maxWind: day.windspeed ?? undefined,
    daysSinceRain: sinceRain[index] ?? undefined,
  }));
  const observed = conditions.filter(
    (_, index) => kindFromSource(days[index].source) === "observed",
  );
  const column = (key) =>
    distribution(observed.map((entry) => entry[key]).filter(Number.isFinite));
  // Prefer the committed climatology: a recent-days baseline is zero-centred,
  // which clamps W flat onto its 0.6 floor.
  const baseline = climatology?.points[pointIndex]?.baseline ?? {
    maxTemperature: column("maxTemperature"),
    humidity: column("humidity"),
    maxWind: column("maxWind"),
    daysSinceRain: column("daysSinceRain"),
  };

  const shown = days.flatMap((day, index) => {
    if (day.datetime < firstShown) return [];
    const complete =
      day.tempmax !== null &&
      day.humidity !== null &&
      day.windspeed !== null &&
      sinceRain[index] !== null;
    return [
      {
        date: day.datetime,
        kind: kindFromSource(day.source),
        maxTemperature: day.tempmax,
        humidity: day.humidity,
        maxWind: day.windspeed,
        precipitation: day.precip,
        daysSinceRain: sinceRain[index],
        precipitation30Day: precipitation30[index],
        weather: complete
          ? weatherFactor(
              {
                maxTemperature: day.tempmax,
                humidity: day.humidity,
                maxWind: day.windspeed,
                daysSinceRain: sinceRain[index],
              },
              baseline,
            )
          : null,
        moisture:
          precipitation30[index] === null
            ? null
            : moistureFactor(precipitation30[index]),
      },
    ];
  });
  assert(shown.length > 0, `Point ${pointIndex} produced no shown days`);
  return { ...point, days: shown };
});

const dates = regional[0].days.map((day) => day.date);
const fixture = {
  fixture: true,
  generatedAt: new Date().toISOString(),
  today,
  dates,
  todayIndex: dates.indexOf(today),
  baselineSource: climatology ? "climatology" : "rolling",
  moistureObservedAt: "fixture",
  regional,
  points: coordinates.map((point) => ({
    ...point,
    regional: nearestRegionalIndex(point, regionalCoordinates),
    soilWaterIndex: null,
  })),
};

assert(fixture.todayIndex >= 0, "Fixture is missing today in its date range");
await writeFile(out, `${JSON.stringify(fixture)}\n`);
console.log(
  `Wrote ${out}: ${dates.length} days (${dates[0]}..${dates[dates.length - 1]}), today ${today}, ${regional.length} regional points.`,
);
