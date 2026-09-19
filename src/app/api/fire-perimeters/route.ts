import { getActivePerimeters } from "@/lib/deepfire";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getActivePerimeters(), {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch {
    return Response.json(
      { error: "DeepFire data is temporarily unavailable." },
      { status: 502 },
    );
  }
}
