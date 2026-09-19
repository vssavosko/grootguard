import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const file = new URL("../public/data/grootguard-cells.json", import.meta.url);
const clipsFile = new URL(
  "../public/data/spain-cell-clips.json",
  import.meta.url,
);
const data = JSON.parse(await readFile(file, "utf8"));
const clips = JSON.parse(await readFile(clipsFile, "utf8"));
const columns = [
  "cells",
  "tree",
  "shrub",
  "grass",
  "land_frac",
  "area_ha",
  "pop",
  "assets",
  "name",
  "province",
];
const length = 14_002;

assert.equal(data.cells.length, length);
for (const name of columns) assert.equal(data[name].length, length, name);
assert.equal(data.asset_classes.length, 6);
assert(data.asset_classes.every((name) => typeof name === "string" && name));
for (const name of ["tree", "shrub", "grass", "land_frac"])
  for (const value of data[name])
    assert(Number.isFinite(value) && value >= 0 && value <= 1, name);
for (const name of ["area_ha", "pop"])
  for (const value of data[name])
    assert(Number.isFinite(value) && value >= 0, name);
for (const id of data.cells) assert(id.startsWith("86"), id);
for (const assets of data.assets) {
  assert.equal(assets.length, 6);
  for (const value of assets) assert(Number.isFinite(value) && value >= 0);
}

assert.equal(clips.excluded.length, 7);
assert.equal(Object.keys(clips.clipped).length, 1_040);
for (const cell of [...clips.excluded, ...Object.keys(clips.clipped)])
  assert(data.cells.includes(cell), cell);
for (const polygons of Object.values(clips.clipped)) {
  assert(Array.isArray(polygons) && polygons.length > 0);
  for (const polygon of polygons)
    for (const ring of polygon)
      for (const point of ring)
        assert(
          Array.isArray(point) &&
            point.length === 2 &&
            point.every(Number.isFinite),
        );
}

const fuelIndex = (tree, shrub, grass) => tree + 0.8 * shrub + 0.5 * grass;
assert.equal(fuelIndex(0.5, 0.25, 0.25), 0.825);
assert.equal(fuelIndex(0, 0, 0), 0);
assert.equal(data.asset_classes.indexOf("hospital"), 0);
assert.deepEqual(
  data.cells.map((_, index) => index).filter((index) => index === 7),
  [7],
);

console.log(
  `Verified ${length.toLocaleString()} GrootGuard cells and ${Object.keys(clips.clipped).length.toLocaleString()} clipped boundaries.`,
);
