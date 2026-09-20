/**
 * The fire hover card reads two different property shapes: live perimeters from
 * DeepFire (`observed_watermark`, `area_m2`) and the reduced season history
 * (`observed`, `area_ha`). Only one of those is easy to reach by hand in a
 * browser, so both are pinned here.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { latLngToCell } from "h3-js";
import ts from "typescript";

const source = await readFile(
  new URL("../src/lib/fire-popup.ts", import.meta.url),
  "utf8",
);
const compiled = ts
  .transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  .outputText.replace(
    /from\s+"h3-js"/,
    `from "${new URL("../node_modules/h3-js/dist/h3-js.es.js", import.meta.url).href}"`,
  );
const { firePopupHtml } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const empty = { data: null, lookup: null };

// Live perimeter shape.
const live = firePopupHtml(
  {
    observed_watermark: "2026-09-19T05:02:00Z",
    area_m2: 570_000,
    n_hotspots: 16,
    active: true,
  },
  40.2,
  -3.7,
  empty,
);
assert.match(live, /Active fire/, "active fire should be labelled as active");
assert.match(live, /2026/, "live perimeter should render its observed date");
assert.match(live, /57 ha/, "570,000 m² should render as 57 ha");
assert.match(live, /0\.57 km²/, "live perimeter should render km²");
assert.match(live, /16/, "hotspot count should be shown");
assert.doesNotMatch(live, /Unknown/, "live shape should not fall through");

// Season history shape.
const burnt = firePopupHtml(
  { observed: "2026-07-22", area_ha: 2301, n_hotspots: 119, active: 0 },
  40.2,
  -3.7,
  empty,
);
assert.match(burnt, /Burnt area/, "inactive fire should read as burnt area");
assert.match(burnt, /2,301 ha/, "season shape should render hectares");
assert.match(burnt, /23\.01 km²/, "season hectares should convert to km²");
assert.doesNotMatch(burnt, /Unknown/, "season shape should not fall through");

// Missing data must say so rather than inventing a number.
const bare = firePopupHtml({}, 40.2, -3.7, empty);
assert.match(bare, /Unknown/, "absent values should read Unknown");

// Cell context, and escaping of place names that carry markup characters.
const withCells = firePopupHtml(
  { observed: "2026-07-22", area_ha: 10, n_hotspots: 1 },
  40.2,
  -3.7,
  {
    data: {
      cells: [latLngToCell(40.2, -3.7, 6)],
      name: ['Vega <b>"del"</b>'],
      province: ["Ávila"],
      pop: [1234],
      assets: [[2, 0, 0, 1, 0, 0]],
      asset_classes: [
        "hospital",
        "power_plant",
        "substation",
        "school",
        "industrial",
        "rail_motorway",
      ],
    },
    lookup: new Map([[latLngToCell(40.2, -3.7, 6), 0]]),
  },
);
assert.doesNotMatch(
  withCells,
  /<b>/,
  "place names must be escaped, not injected as markup",
);
assert.match(withCells, /1,234/, "cell population should be shown");
assert.match(withCells, /hospital 2/, "cell assets should be listed");
assert.match(
  withCells,
  /not a\s+damage assessment/,
  "the card must keep saying this is not a damage assessment",
);

console.log(
  "Verified fire hover card for live, season, empty and cell-context shapes.",
);
