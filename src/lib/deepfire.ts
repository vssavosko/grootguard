import "server-only";

const TOKEN_URL = "https://api.deepfire.co/v1/token";
const PERIMETERS_URL =
  "https://api.deepfire.co/ogc/features/v1/collections/deepfire:satellite-perimeters/items";
const SPAIN_BBOX = "-9.5,35.5,4.5,44.5";
type TokenResponse = { access_token: string; expires_in: number };
let cachedToken: { value: string; expiresAt: number } | undefined;

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now())
    return cachedToken.value;
  const clientId = process.env.DEEPFIRE_CLIENT_ID;
  const clientSecret = process.env.DEEPFIRE_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    throw new Error("DeepFire credentials are not configured.");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("DeepFire authentication failed.");
  const token = (await response.json()) as TokenResponse;
  cachedToken = {
    value: token.access_token,
    expiresAt: Date.now() + Math.max(token.expires_in - 30, 0) * 1000,
  };
  return cachedToken.value;
}

export async function getActivePerimeters() {
  const url = new URL(PERIMETERS_URL);
  url.searchParams.set("bbox", SPAIN_BBOX);
  url.searchParams.set("filter-lang", "cql2-text");
  url.searchParams.set("filter", "active = true");
  url.searchParams.set("f", "application/geo+json");
  url.searchParams.set("limit", "1000");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${await getAccessToken()}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("DeepFire perimeters request failed.");
  return response.json();
}
