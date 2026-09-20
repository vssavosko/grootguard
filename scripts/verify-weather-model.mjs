import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

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
const { moistureFactor, priority, rankChanges, weatherFactor } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const baseline = {
  maxTemperature: { mean: 20, standardDeviation: 1 },
  humidity: { mean: 50, standardDeviation: 1 },
  maxWind: { mean: 10, standardDeviation: 1 },
  daysSinceRain: { mean: 10, standardDeviation: 1 },
};

assert.equal(
  weatherFactor(
    {
      maxTemperature: 100,
      humidity: -100,
      maxWind: 100,
      daysSinceRain: 100,
    },
    baseline,
  ),
  1.6,
);
assert.equal(
  weatherFactor(
    {
      maxTemperature: -100,
      humidity: 100,
      maxWind: -100,
      daysSinceRain: -100,
    },
    baseline,
  ),
  0.6,
);
assert.equal(moistureFactor(-1), 0);
assert.equal(moistureFactor(30), 0.5);
assert.equal(moistureFactor(120), 1);
const assertClose = (actual, expected) =>
  assert(Math.abs(actual - expected) < 1e-12);
assertClose(priority(0.5, 1.2, 0.25, 0.8), 0.408);
assert.deepEqual(rankChanges([30, 10, 20], [10, 20, 30]), [2, -1, -1]);
assert.deepEqual(rankChanges([30, null, 20], [10, 20, 30]), [2, null, -1]);

console.log(
  "Verified weather factors, moisture bounds, priority, and rank direction.",
);
