import { getWeatherSnapshot } from "@/lib/weather";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getWeatherSnapshot(), {
      headers: { "Cache-Control": "private, max-age=86400" },
    });
  } catch (error) {
    console.error("Weather data request failed", error);
    return Response.json(
      { error: "Weather data is temporarily unavailable." },
      { status: 502 },
    );
  }
}
