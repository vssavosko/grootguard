import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import ts from "typescript";

const source = await readFile(
  new URL("../src/lib/soil-moisture.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  decodeSingleBandTiff,
  latestSwiKey,
  pixelAtCoordinate,
  soilWaterIndexAt,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

function tiffWithDeflatedTile(values) {
  const data = deflateSync(Buffer.from(values));
  const ifdOffset = 8;
  const entries = 9;
  const tileOffset = ifdOffset + 2 + entries * 12 + 4;
  const buffer = Buffer.alloc(tileOffset + data.length);
  buffer.writeUInt16LE(0x4949, 0);
  buffer.writeUInt16LE(42, 2);
  buffer.writeUInt32LE(ifdOffset, 4);
  buffer.writeUInt16LE(entries, ifdOffset);
  const entry = (index, tag, type, count, value) => {
    const offset = ifdOffset + 2 + index * 12;
    buffer.writeUInt16LE(tag, offset);
    buffer.writeUInt16LE(type, offset + 2);
    buffer.writeUInt32LE(count, offset + 4);
    buffer.writeUInt32LE(value, offset + 8);
  };
  entry(0, 256, 4, 1, 2);
  entry(1, 257, 4, 1, 2);
  entry(2, 258, 3, 1, 8);
  entry(3, 259, 3, 1, 8);
  entry(4, 277, 3, 1, 1);
  entry(5, 322, 4, 1, 2);
  entry(6, 323, 4, 1, 2);
  entry(7, 324, 4, 1, tileOffset);
  entry(8, 325, 4, 1, data.length);
  data.copy(buffer, tileOffset);
  return buffer;
}

const grid = decodeSingleBandTiff(tiffWithDeflatedTile([0, 12, 255, 200]));
assert.deepEqual([...grid.values], [0, 12, 255, 200]);
assert.equal(grid.width, 2);
assert.equal(grid.height, 2);
assert.equal(soilWaterIndexAt(grid, 0, 1), null);
assert.equal(soilWaterIndexAt(grid, 1, 1), 100);
assert.deepEqual(pixelAtCoordinate(-3.7, 40.2), { x: 1763, y: 498 });
assert.equal(
  latestSwiKey(
    "<Contents><Key>path/c_gls_SWI-SWI005_latest.tiff</Key></Contents><Contents><Key>path/c_gls_SWI-SWI001_latest.tiff</Key></Contents>",
  ),
  "path/c_gls_SWI-SWI001_latest.tiff",
);
assert.equal(
  latestSwiKey("<Key>path/c_gls_SWI10-SWI001_latest.tiff</Key>"),
  "path/c_gls_SWI10-SWI001_latest.tiff",
);

console.log("Verified Deflate GeoTIFF decoding for a single SWI tile.");
