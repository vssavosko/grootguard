import "server-only";

import { readFile } from "node:fs/promises";
import { cellToLatLng } from "h3-js";
import { soilWaterIndex } from "@/lib/soil-moisture";
import {
  type BaselineSource,
  baselineFromSample,
  isUsableBaseline,
} from "@/lib/weather-baseline";
import {
  moistureFactor,
  type WeatherBaseline,
  weatherFactor,
} from "@/lib/weather-model";
import cells from "../../public/data/grootguard-cells.json";

const VISUAL_CROSSING_URL =
  "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline";
const TIME_ZONE = "Europe/Madrid";
const REGIONAL_POINT_COUNT = 10;
const BASELINE_FILE = "public/data/weather-baseline.json";

/** Timeline span, relative to today in Madrid. */
export const PAST_DAYS = 7;
export const FUTURE_DAYS = 14;
/** Moisture is a 30-day precipitation window, so the fetch needs a lead-in. */
const MOISTURE_WINDOW_DAYS = 30;
const LEAD_IN_DAYS = PAST_DAYS + MOISTURE_WINDOW_DAYS;
/** Rain threshold for the "days since rain" term, in millimetres. */
const RAIN_THRESHOLD_MM = 1;
/**
 * A full refresh costs about 38 provider records per regional point, so a
 * once-daily revalidate keeps ten points inside a 1,000-record daily budget.
 */
const CACHE_SECONDS = 86_400;
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BACKOFF_MS = 1_200;

export type DayKind = "observed" | "combined" | "forecast";
export type PointDay = {
  date: string;
  kind: DayKind;
  maxTemperature: number | null;
  humidity: number | null;
  maxWind: number | null;
  precipitation: number | null;
  daysSinceRain: number | null;
  precipitation30Day: number | null;
  /** Bounded fire-weather factor W, 0.6-1.6. */
  weather: number | null;
  /** Bounded moisture factor M, 0-1. */
  moisture: number | null;
};
export type RegionalSeries = {
  latitude: number;
  longitude: number;
  days: PointDay[];
};
export type WeatherPoint = {
  latitude: number;
  longitude: number;
  /** Index into `regional`; every cell reads W and M through its nearest point. */
  regional: number;
  /** Copernicus soil water index, observed once and not part of the timeline. */
  soilWaterIndex: number | null;
};
export type WeatherSeries = {
  /** True when served from a recorded fixture instead of the live provider. */
  fixture?: boolean;
  generatedAt: string;
  today: string;
  /** Ordered dates, `PAST_DAYS` before today through `FUTURE_DAYS` after. */
  dates: string[];
  /** Index into `dates` that represents today. */
  todayIndex: number;
  baselineSource: BaselineSource;
  moistureObservedAt: string;
  regional: RegionalSeries[];
  points: WeatherPoint[];
};

type Daily = {
  datetime: string;
  source?: string;
  tempmax?: number;
  humidity?: number;
  windspeed?: number;
  precip?: number;
};
type Coordinate = { latitude: number; longitude: number };

const numberOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const dateInTimeZone = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts();
  const value = (name: "year" | "month" | "day") =>
    parts.find((part) => part.type === name)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) throw new Error("Could not determine today.");
  return `${year}-${month}-${day}`;
};

const shiftDate = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

function kindFromSource(source: string | undefined): DayKind {
  if (source === "obs") return "observed";
  if (source === "fcst") return "forecast";
  return "combined";
}

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * One daily range for one point.
 *
 * Visual Crossing rate-limits concurrent bursts, so callers fetch points in
 * sequence; a 429 is still retried with backoff rather than failing the whole
 * series for a transient throttle.
 */
async function fetchDailyRange(point: Coordinate, from: string, to: string) {
  const key = process.env.VISUAL_CROSSING_API_KEY;
  if (!key) throw new Error("VISUAL_CROSSING_API_KEY is not configured.");
  const url = new URL(
    `${VISUAL_CROSSING_URL}/${point.latitude},${point.longitude}/${from}/${to}`,
  );
  url.searchParams.set("unitGroup", "metric");
  url.searchParams.set("include", "days");
  url.searchParams.set(
    "elements",
    "datetime,source,tempmax,humidity,windspeed,precip",
  );
  url.searchParams.set("key", key);

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { next: { revalidate: CACHE_SECONDS } });
    if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      await wait(RATE_LIMIT_BACKOFF_MS * (attempt + 1));
      continue;
    }
    if (!response.ok)
      throw new Error(`Visual Crossing request failed (${response.status}).`);
    const payload = (await response.json()) as { days?: Daily[] };
    if (!Array.isArray(payload.days) || payload.days.length === 0)
      throw new Error("Visual Crossing returned no daily records.");
    return payload.days;
  }
}

/**
 * Days since the last day with at least `RAIN_THRESHOLD_MM` of rain, counted
 * across the fetched lead-in. Null until the first wet day is seen, so a dry
 * lead-in never fabricates a small number.
 */
function daysSinceRainSeries(days: Daily[]) {
  let since: number | null = null;
  return days.map((day) => {
    const precipitation = numberOrNull(day.precip);
    if (precipitation !== null && precipitation >= RAIN_THRESHOLD_MM) {
      since = 0;
      return 0;
    }
    since = since === null ? null : since + 1;
    return since;
  });
}

/** Rolling `MOISTURE_WINDOW_DAYS` precipitation total ending at each index. */
function precipitation30DaySeries(days: Daily[]) {
  return days.map((_, index) => {
    if (index + 1 < MOISTURE_WINDOW_DAYS) return null;
    const window = days.slice(index + 1 - MOISTURE_WINDOW_DAYS, index + 1);
    const values = window.map((day) => numberOrNull(day.precip));
    if (values.some((value) => value === null)) return null;
    return values.reduce((sum: number, value) => sum + (value ?? 0), 0);
  });
}

function regionalPointIndexes(coordinates: Coordinate[]) {
  const indexes = [0];
  while (indexes.length < Math.min(REGIONAL_POINT_COUNT, coordinates.length)) {
    let next = -1;
    let farthest = -1;
    for (let index = 0; index < coordinates.length; index++) {
      if (indexes.includes(index)) continue;
      const distance = Math.min(
        ...indexes.map((selected) => {
          const latitude =
            coordinates[index].latitude - coordinates[selected].latitude;
          const longitude =
            coordinates[index].longitude - coordinates[selected].longitude;
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

function nearestRegionalIndex(coordinate: Coordinate, regional: Coordinate[]) {
  return regional.reduce(
    (closest, candidate, index) => {
      const latitude = coordinate.latitude - candidate.latitude;
      const longitude = coordinate.longitude - candidate.longitude;
      const distance = latitude ** 2 + longitude ** 2;
      return distance < closest.distance ? { index, distance } : closest;
    },
    { index: 0, distance: Number.POSITIVE_INFINITY },
  ).index;
}

type BaselineFile = {
  points: Array<{
    latitude: number;
    longitude: number;
    baseline: WeatherBaseline;
  }>;
};

/** Committed climatological baselines, when the snapshot script has been run. */
async function loadClimatology(): Promise<BaselineFile | null> {
  try {
    const parsed = JSON.parse(
      await readFile(BASELINE_FILE, "utf8"),
    ) as BaselineFile;
    return Array.isArray(parsed.points) && parsed.points.length > 0
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * Serve a recorded series instead of calling the provider.
 *
 * Opt-in through `WEATHER_FIXTURE_FILE` for offline development and CI, where
 * the provider's daily record budget would otherwise be spent on reloads. The
 * payload keeps `fixture: true` so the UI can say the data is not live.
 */
async function loadFixture(path: string): Promise<WeatherSeries> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as WeatherSeries;
  if (!Array.isArray(parsed.dates) || parsed.dates.length === 0)
    throw new Error("Weather fixture does not contain a date series.");
  return { ...parsed, fixture: true };
}

export async function getWeatherSeries(): Promise<WeatherSeries> {
  const fixturePath = process.env.WEATHER_FIXTURE_FILE;
  if (fixturePath) return loadFixture(fixturePath);

  const coordinates: Coordinate[] = cells.weather_points.map((point) => {
    const [latitude, longitude] = cellToLatLng(point);
    return { latitude, longitude };
  });
  const today = dateInTimeZone();
  const from = shiftDate(today, -LEAD_IN_DAYS);
  const to = shiftDate(today, FUTURE_DAYS);
  const firstShown = shiftDate(today, -PAST_DAYS);

  const regionalIndexes = regionalPointIndexes(coordinates);
  const regionalCoordinates = regionalIndexes.map(
    (index) => coordinates[index],
  );

  const moisturePromise = soilWaterIndex(coordinates);
  const climatology = await loadClimatology();
  // Sequential on purpose: the provider throttles concurrent bursts.
  const ranges: Daily[][] = [];
  for (const point of regionalCoordinates) {
    ranges.push(await fetchDailyRange(point, from, to));
  }

  const regional: RegionalSeries[] = ranges.map((days, pointIndex) => {
    const sinceRain = daysSinceRainSeries(days);
    const precipitation30 = precipitation30DaySeries(days);
    const conditions = days.map((day, index) => ({
      maxTemperature: numberOrNull(day.tempmax) ?? undefined,
      humidity: numberOrNull(day.humidity) ?? undefined,
      maxWind: numberOrNull(day.windspeed) ?? undefined,
      daysSinceRain: sinceRain[index] ?? undefined,
    }));
    const observedSample = conditions.filter(
      (_, index) => kindFromSource(days[index].source) === "observed",
    );
    const point = regionalCoordinates[pointIndex];
    const matched = climatology?.points[pointIndex]?.baseline;
    const baseline =
      matched && isUsableBaseline(matched)
        ? matched
        : baselineFromSample(observedSample);

    const shown = days.flatMap((day, index): PointDay[] => {
      if (day.datetime < firstShown) return [];
      const maxTemperature = numberOrNull(day.tempmax);
      const humidity = numberOrNull(day.humidity);
      const maxWind = numberOrNull(day.windspeed);
      const daysSinceRain = sinceRain[index];
      const precipitation30Day = precipitation30[index];
      const complete =
        maxTemperature !== null &&
        humidity !== null &&
        maxWind !== null &&
        daysSinceRain !== null;
      return [
        {
          date: day.datetime,
          kind: kindFromSource(day.source),
          maxTemperature,
          humidity,
          maxWind,
          precipitation: numberOrNull(day.precip),
          daysSinceRain,
          precipitation30Day,
          weather: complete
            ? weatherFactor(
                { maxTemperature, humidity, maxWind, daysSinceRain },
                baseline,
              )
            : null,
          moisture:
            precipitation30Day === null
              ? null
              : moistureFactor(precipitation30Day),
        },
      ];
    });
    return { ...point, days: shown };
  });

  const dates = regional[0]?.days.map((day) => day.date) ?? [];
  if (regional.some((series) => series.days.length !== dates.length))
    throw new Error("Weather points returned mismatched date ranges.");

  const moisture = await moisturePromise;
  const points: WeatherPoint[] = coordinates.map((coordinate, index) => ({
    ...coordinate,
    regional: nearestRegionalIndex(coordinate, regionalCoordinates),
    soilWaterIndex: moisture.values[index],
  }));

  return {
    generatedAt: new Date().toISOString(),
    today,
    dates,
    todayIndex: dates.indexOf(today),
    baselineSource: climatology ? "climatology" : "rolling",
    moistureObservedAt: moisture.observedAt,
    regional,
    points,
  };
}
