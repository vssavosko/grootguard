import type { WeatherBaseline, WeatherConditions } from "@/lib/weather-model";

export type BaselineSource = "climatology" | "rolling";

/** Mean and standard deviation of a finite sample; zero spread when degenerate. */
function distribution(values: number[]) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { mean: 0, standardDeviation: 0 };
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance =
    finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
  return { mean, standardDeviation: Math.sqrt(variance) };
}

/**
 * Build z-score baselines from a sample of days.
 *
 * The design spec calls for a 2016-2025 daily archive per point. That costs
 * thousands of provider records, so it lives in a committed snapshot built by
 * `scripts/build-weather-baseline.mjs`. When that snapshot is absent we fall
 * back to the observed days already fetched for the timeline, which makes W an
 * anomaly against recent local conditions rather than against climatology.
 * The route reports which source was used so the UI can say so.
 */
export function baselineFromSample(
  sample: Array<Partial<WeatherConditions>>,
): WeatherBaseline {
  const column = (key: keyof WeatherConditions) =>
    distribution(
      sample.flatMap((day) => {
        const value = day[key];
        return typeof value === "number" && Number.isFinite(value)
          ? [value]
          : [];
      }),
    );
  return {
    maxTemperature: column("maxTemperature"),
    humidity: column("humidity"),
    maxWind: column("maxWind"),
    daysSinceRain: column("daysSinceRain"),
  };
}

export function isUsableBaseline(baseline: WeatherBaseline) {
  return [
    baseline.maxTemperature,
    baseline.humidity,
    baseline.maxWind,
    baseline.daysSinceRain,
  ].every(
    (entry) =>
      Number.isFinite(entry.mean) && Number.isFinite(entry.standardDeviation),
  );
}
