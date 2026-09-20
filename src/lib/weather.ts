import "server-only";

import { cellToLatLng } from "h3-js";
import { soilWaterIndex } from "@/lib/soil-moisture";
import cells from "../../public/data/grootguard-cells.json";

const VISUAL_CROSSING_URL =
  "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline";
const TIME_ZONE = "Europe/Madrid";
const REGIONAL_POINT_COUNT = 10;

type Daily = { datetime: string; source?: string; tempmax?: number };
type PointObservation = {
  latitude: number;
  longitude: number;
  current: { weather: number | null; moisture: number | null };
};
export type WeatherSnapshot = {
  generatedAt: string;
  cutoff: string;
  moistureObservedAt: string;
  points: PointObservation[];
};

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
  if (!year || !month || !day) throw new Error("Could not determine cutoff.");
  return `${year}-${month}-${day}`;
};

const shiftDate = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

async function fetchObservedTemperature(
  point: { latitude: number; longitude: number },
  date: string,
) {
  const key = process.env.VISUAL_CROSSING_API_KEY;
  if (!key) throw new Error("VISUAL_CROSSING_API_KEY is not configured.");
  const url = new URL(
    `${VISUAL_CROSSING_URL}/${point.latitude},${point.longitude}/${date}/${date}`,
  );
  url.searchParams.set("unitGroup", "metric");
  url.searchParams.set("include", "days,obs");
  url.searchParams.set("key", key);
  const response = await fetch(url, { next: { revalidate: 86_400 } });
  if (!response.ok)
    throw new Error(`Visual Crossing request failed (${response.status}).`);
  const payload = (await response.json()) as { days?: Daily[] };
  const day = payload.days?.find((candidate) => candidate.datetime === date);
  return day?.source === "obs" && typeof day.tempmax === "number"
    ? day.tempmax
    : null;
}

function regionalPointIndexes(
  coordinates: Array<{ latitude: number; longitude: number }>,
) {
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

function nearestRegionalIndex(
  coordinate: { latitude: number; longitude: number },
  regional: Array<{ latitude: number; longitude: number }>,
) {
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

export async function getWeatherSnapshot(): Promise<WeatherSnapshot> {
  const coordinates = cells.weather_points.map((point) => {
    const [latitude, longitude] = cellToLatLng(point);
    return { latitude, longitude };
  });
  const cutoff = shiftDate(dateInTimeZone(), -1);
  // ponytail: ten regional observations cost ten daily records; add stations only with more quota.
  const regional = regionalPointIndexes(coordinates).map(
    (index) => coordinates[index],
  );
  const moisturePromise = soilWaterIndex(coordinates);
  const temperatures: Array<number | null> = [];
  for (const point of regional) {
    temperatures.push(await fetchObservedTemperature(point, cutoff));
  }
  const moisture = await moisturePromise;
  const points: PointObservation[] = coordinates.map((coordinate, index) => ({
    ...coordinate,
    current: {
      weather: temperatures[nearestRegionalIndex(coordinate, regional)],
      moisture: moisture.values[index],
    },
  }));
  return {
    generatedAt: new Date().toISOString(),
    cutoff,
    moistureObservedAt: moisture.observedAt,
    points,
  };
}
