# Weather Layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render live Weather W, Moisture M, dynamic priority, and week-over-week rank change on the existing Spain map.

**Architecture:** Retain the committed static H3 snapshot as the client-side geometry and consequence source. A server-only Open-Meteo adapter calculates the original GrootGuard W/M factors for the existing 66 weather points, exposes a cacheable route response, and the map expands those values to cells for styling and rankings.

**Tech Stack:** Next.js 16 Route Handlers, TypeScript, Mapbox GL JS, H3 JS, Panda CSS, built-in Node assertions.

## Global Constraints

- Do not add packages, databases, cron jobs, or browser-to-provider requests.
- Reuse `cells.wpt`, `cells.weather_points`, `tree`, `shrub`, `grass`, and `C` from `public/data/grootguard-cells.json`.
- Preserve static fuel and population/assets layers if the weather route fails.
- Use the original model: `priority = F * W * (0.4 + .6 * (1 - M)) * C`.
- Treat source-model constants as assumptions, never as an official fire warning.

---

### Task 1: Pure dynamic-priority model

**Files:**
- Create: `src/lib/weather-model.ts`
- Create: `scripts/verify-weather-model.mjs`
- Modify: `src/lib/analytics-layer.ts`

**Interfaces:**
- Produces `weatherFactor`, `moistureFactor`, `priority`, and `rankChanges` pure functions.
- Extends `PreparedCells` with existing JSON columns `C`, `wpt`, and `weather_points`.

- [ ] Write assertion cases for W clamping, 30-day precipitation moisture clamping, priority multiplication, and rank direction.
- [ ] Implement only those pure functions and run `node scripts/verify-weather-model.mjs`.
- [ ] Extend the static cell type without changing the dataset file.

### Task 2: Server-only Open-Meteo adapter and route

**Files:**
- Create: `src/lib/weather.ts`
- Create: `src/app/api/weather/route.ts`

**Interfaces:**
- Produces `WeatherSnapshot { generatedAt, cutoff, points, current: { W, M }, previous: { W, M } }` aligned to `weather_points`.
- Consumes fixed source-model constants and Open-Meteo daily archive/forecast responses.

- [ ] Fetch the 2016-2025 daily archive once per cached weather-point request and calculate z-score baselines.
- [ ] Fetch enough complete recent days to calculate current and previous seven-day windows plus each preceding 30-day moisture window.
- [ ] Validate all response array lengths and finite values before returning a snapshot.
- [ ] Return 502 on provider/decode failure and cache successful provider fetches with Next `revalidate` options.
- [ ] Run typecheck and manually call the route in the dev server with no provider credentials required.

### Task 3: Dynamic Mapbox source and rank state

**Files:**
- Modify: `src/lib/analytics-layer.ts`
- Modify: `src/components/world-map.tsx`

**Interfaces:**
- Adds `priority`, `weather`, and `moisture` layer keys.
- Produces feature properties `weather`, `moisture`, `priority`, `previous_priority`, and `rank_change`.

- [ ] Fetch `/api/weather` alongside existing static analytics data and retain an explicit unavailable state.
- [ ] Expand the 66 point values through `wpt`, compute dynamic values, and update/add the Mapbox GeoJSON source.
- [ ] Add color ramps for priority, W, and M; leave static layers untouched.
- [ ] Verify that a failed weather request leaves the map and static controls usable.

### Task 4: Analytical controls, cell detail, and ranking

**Files:**
- Modify: `src/components/analytics-layer-control.tsx`
- Create: `src/components/top-zones.tsx`
- Modify: `src/components/world-map.tsx`

**Interfaces:**
- Consumes prepared cells and an optional dynamic snapshot.
- Renders a selected cell's F, W, M, C, priority, and rank change plus the top ten valid dynamic cells.

- [ ] Add Priority, Weather W, and Moisture M controls with accurate legends and source/cutoff copy.
- [ ] Render unavailable and no-data states without numeric placeholders.
- [ ] Add a compact desktop ranking panel and responsive narrow-screen stacking.
- [ ] Run `pnpm verify:analytics`, `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build`.
