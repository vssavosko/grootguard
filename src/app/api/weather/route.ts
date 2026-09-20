import { getWeatherSeries } from "@/lib/weather";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getWeatherSeries(), {
      // The server-side `revalidate` on the provider fetches already protects
      // the daily record budget. Keeping the browser out of the cache means a
      // payload-shape change is never served stale to a newer build.
      headers: { "Cache-Control": "private, no-cache" },
    });
  } catch (error) {
    console.error("Weather data request failed", error);
    return Response.json(
      { error: "Weather data is temporarily unavailable." },
      { status: 502 },
    );
  }
}
