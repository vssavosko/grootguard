import { createHash, createHmac } from "node:crypto";
import { inflateSync } from "node:zlib";

const ENDPOINT = "https://eodata.dataspace.copernicus.eu";
const BUCKET = "eodata";
const REGION = "default";
const SERVICE = "s3";
const SWI_PREFIX =
  "CLMS/bio-geophysical/soil_water_index/swi_global_12.5km_daily_v4";
const SWI_10DAY_PREFIX =
  "CLMS/bio-geophysical/soil_water_index/swi_global_12.5km_10daily_v4";

type TiffEntry = {
  type: number;
  count: number;
  valueOffset: number;
};

const TYPE_SIZE: Record<number, number> = { 3: 2, 4: 4 };

function entries(view: DataView) {
  if (view.getUint16(0, true) !== 0x4949 || view.getUint16(2, true) !== 42)
    throw new Error("Expected a little-endian TIFF.");
  const offset = view.getUint32(4, true);
  const count = view.getUint16(offset, true);
  const result = new Map<number, TiffEntry>();
  for (let index = 0; index < count; index++) {
    const entry = offset + 2 + index * 12;
    result.set(view.getUint16(entry, true), {
      type: view.getUint16(entry + 2, true),
      count: view.getUint32(entry + 4, true),
      valueOffset: entry + 8,
    });
  }
  return result;
}

function values(view: DataView, entry: TiffEntry) {
  const size = TYPE_SIZE[entry.type];
  if (!size) throw new Error("Unsupported TIFF field type.");
  const offset =
    entry.count * size <= 4
      ? entry.valueOffset
      : view.getUint32(entry.valueOffset, true);
  return Array.from({ length: entry.count }, (_, index) =>
    entry.type === 3
      ? view.getUint16(offset + index * size, true)
      : view.getUint32(offset + index * size, true),
  );
}

export function decodeSingleBandTiff(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fields = entries(view);
  const field = (tag: number) => {
    const entry = fields.get(tag);
    if (!entry) throw new Error(`TIFF is missing field ${tag}.`);
    return values(view, entry);
  };
  const [width] = field(256);
  const [height] = field(257);
  const [bitsPerSample] = field(258);
  const [compression] = field(259);
  const [samplesPerPixel] = field(277);
  const [tileWidth] = field(322);
  const [tileHeight] = field(323);
  const offsets = field(324);
  const byteCounts = field(325);
  if (
    bitsPerSample !== 8 ||
    compression !== 8 ||
    samplesPerPixel !== 1 ||
    offsets.length !== byteCounts.length
  )
    throw new Error("Unsupported SWI GeoTIFF layout.");

  const output = new Uint8Array(width * height);
  const tilesAcross = Math.ceil(width / tileWidth);
  for (let tile = 0; tile < offsets.length; tile++) {
    const pixels = inflateSync(
      bytes.subarray(offsets[tile], offsets[tile] + byteCounts[tile]),
    );
    const tileX = (tile % tilesAcross) * tileWidth;
    const tileY = Math.floor(tile / tilesAcross) * tileHeight;
    for (let y = 0; y < tileHeight && tileY + y < height; y++) {
      const row = y * tileWidth;
      output.set(
        pixels.subarray(row, row + Math.min(tileWidth, width - tileX)),
        (tileY + y) * width + tileX,
      );
    }
  }
  return { width, height, values: output };
}

export function soilWaterIndexAt(
  grid: { width: number; height: number; values: Uint8Array },
  x: number,
  y: number,
) {
  const raw = grid.values[y * grid.width + x];
  return raw === 255 || raw > 200 ? null : raw * 0.5;
}

export function pixelAtCoordinate(longitude: number, latitude: number) {
  return {
    x: Math.floor((longitude + 180) * 10),
    y: Math.floor((90 - latitude) * 10),
  };
}

export function latestSwiKey(listing: string) {
  return (
    listing.match(/<Key>([^<]*SWI(?:10)?-SWI001[^<]*\.tiff)<\/Key>/)?.[1] ??
    null
  );
}

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) =>
  createHmac("sha256", key).update(value).digest();
const encode = (value: string) =>
  encodeURIComponent(value).replace(/%7E/g, "~");

function s3Path(key = "") {
  return `/${[BUCKET, ...key.split("/").filter(Boolean)].map(encode).join("/")}`;
}

async function s3Get(key: string, params: Record<string, string> = {}) {
  const accessKey = process.env.COPERNICUS_ACCESS_KEY;
  const secret = process.env.COPERNICUS_SK;
  if (!accessKey || !secret)
    throw new Error("Copernicus S3 credentials are not configured.");

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const canonicalQuery = Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${encode(name)}=${encode(value)}`)
    .join("&");
  const path = s3Path(key);
  const payloadHash = hash("");
  const canonicalHeaders =
    `host:${new URL(ENDPOINT).host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const scope = `${day}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    hash(
      `GET\n${path}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`,
    ),
  ].join("\n");
  const dateKey = hmac(`AWS4${secret}`, day);
  const regionKey = hmac(dateKey, REGION);
  const serviceKey = hmac(regionKey, SERVICE);
  const signature = hmac(
    hmac(serviceKey, "aws4_request"),
    stringToSign,
  ).toString("hex");
  const response = await fetch(
    `${ENDPOINT}${path}${canonicalQuery ? `?${canonicalQuery}` : ""}`,
    {
      cache: "no-store",
      headers: {
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
      },
    },
  );
  if (!response.ok)
    throw new Error(`Copernicus S3 request failed (${response.status}).`);
  return response;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "/");
}

async function newestSwiKey(prefix = SWI_PREFIX) {
  for (let offset = 0; offset < 14; offset++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    const datedPrefix = `${prefix}/${dateKey(date)}/`;
    const listing = await (
      await s3Get("", {
        "list-type": "2",
        "max-keys": "1000",
        prefix: datedPrefix,
      })
    ).text();
    const key = latestSwiKey(listing);
    if (key) return key;
  }
  throw new Error("No recent Copernicus Soil Water Index file was found.");
}

async function newestCompositeSwiKey() {
  const now = new Date();
  for (let monthOffset = 0; monthOffset < 3; monthOffset++) {
    const month = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthOffset, 1),
    );
    for (const day of [21, 11, 1]) {
      const date = new Date(month);
      date.setUTCDate(day);
      const prefix = `${SWI_10DAY_PREFIX}/${dateKey(date)}/`;
      const listing = await (
        await s3Get("", { "list-type": "2", "max-keys": "1000", prefix })
      ).text();
      const key = latestSwiKey(listing);
      if (key) return key;
    }
  }
  throw new Error(
    "No recent Copernicus 10-day Soil Water Index file was found.",
  );
}

async function valuesForKey(
  key: string,
  coordinates: Array<{ latitude: number; longitude: number }>,
) {
  const grid = decodeSingleBandTiff(
    new Uint8Array(await (await s3Get(key)).arrayBuffer()),
  );
  const observedAt = key.match(/SWI(?:10)?_(\d{8})\d{4}/)?.[1];
  if (!observedAt)
    throw new Error("Copernicus SWI file has no observation date.");
  return {
    observedAt: `${observedAt.slice(0, 4)}-${observedAt.slice(4, 6)}-${observedAt.slice(6, 8)}`,
    values: coordinates.map(({ latitude, longitude }) => {
      const { x, y } = pixelAtCoordinate(longitude, latitude);
      return x < 0 || y < 0 || x >= grid.width || y >= grid.height
        ? null
        : soilWaterIndexAt(grid, x, y);
    }),
  };
}

export async function soilWaterIndex(
  coordinates: Array<{ latitude: number; longitude: number }>,
) {
  const daily = await valuesForKey(await newestSwiKey(), coordinates);
  if (daily.values.every((value) => value !== null)) return daily;
  const composite = await valuesForKey(
    await newestCompositeSwiKey(),
    coordinates,
  );
  return {
    observedAt: `${composite.observedAt}–${daily.observedAt}`,
    values: daily.values.map(
      (value, index) => value ?? composite.values[index],
    ),
  };
}
