import { getSeasonPerimeters } from "@/lib/deepfire";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getSeasonPerimeters(), {
      // The season footprint only grows as new fires are observed, so a short
      // browser cache is safe and keeps the multi-megabyte payload off the wire.
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  } catch (error) {
    console.error("DeepFire season request failed", error);
    return Response.json(
      { error: "Season fire history is temporarily unavailable." },
      { status: 502 },
    );
  }
}
