export type WeatherConditions = {
  maxTemperature: number;
  humidity: number;
  maxWind: number;
  daysSinceRain: number;
};

export type WeatherBaseline = {
  maxTemperature: { mean: number; standardDeviation: number };
  humidity: { mean: number; standardDeviation: number };
  maxWind: { mean: number; standardDeviation: number };
  daysSinceRain: { mean: number; standardDeviation: number };
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const zScore = (value: number, mean: number, standardDeviation: number) =>
  standardDeviation === 0 ? 0 : (value - mean) / standardDeviation;

export function weatherFactor(
  conditions: WeatherConditions,
  baseline: WeatherBaseline,
) {
  const value =
    0.6 +
    0.25 *
      zScore(
        conditions.maxTemperature,
        baseline.maxTemperature.mean,
        baseline.maxTemperature.standardDeviation,
      ) +
    0.25 *
      zScore(
        -conditions.humidity,
        -baseline.humidity.mean,
        baseline.humidity.standardDeviation,
      ) +
    0.25 *
      zScore(
        conditions.maxWind,
        baseline.maxWind.mean,
        baseline.maxWind.standardDeviation,
      ) +
    0.25 *
      zScore(
        conditions.daysSinceRain,
        baseline.daysSinceRain.mean,
        baseline.daysSinceRain.standardDeviation,
      );

  return clamp(value, 0.6, 1.6);
}

export function moistureFactor(precipitation30Day: number) {
  return clamp(precipitation30Day / 60, 0, 1);
}

export function priority(
  fuel: number,
  weather: number,
  moisture: number,
  consequence: number,
) {
  return fuel * weather * (0.4 + 0.6 * (1 - moisture)) * consequence;
}

/** Positive values mean the cell moved up toward rank 1. */
export function rankChanges(
  currentPriorities: Array<number | null>,
  previousPriorities: Array<number | null>,
) {
  if (currentPriorities.length !== previousPriorities.length)
    throw new Error("Priority arrays must have the same length");

  const rank = (values: Array<number | null>) => {
    const ranked = values
      .map((value, index) => ({ value, index }))
      .filter((item): item is { value: number; index: number } =>
        Number.isFinite(item.value),
      )
      .sort((a, b) => b.value - a.value || a.index - b.index);
    return new Map(ranked.map(({ index }, position) => [index, position + 1]));
  };

  const currentRanks = rank(currentPriorities);
  const previousRanks = rank(previousPriorities);
  return currentPriorities.map((value, index) => {
    const currentRank = currentRanks.get(index);
    const previousRank = previousRanks.get(index);
    return value == null || currentRank == null || previousRank == null
      ? null
      : previousRank - currentRank;
  });
}
