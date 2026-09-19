# Weather and Moisture Layers Design

## Goal

Add live, separately visible weather (`W`) and moisture (`M`) factors to the existing Spain H3 map, use them with the existing fuel (`F`) and consequence (`C`) snapshot to calculate a dynamic prevention-priority rank, and display a week-over-week rank change.

## Data contract

- Keep the existing 14,002 H3 resolution-6 cells and their 66 `wpt` assignments unchanged.
- Keep `F` and `C` as static values from the committed GrootGuard snapshot.
- Fetch weather only on the server from Open-Meteo. The browser never calls the provider directly.
- `W` is the source model's bounded fire-weather factor: `clamp(0.6 + .25*z(max temperature) + .25*z(-min humidity) + .25*z(max wind) + .25*z(days since >=1 mm rain), .6, 1.6)`. Per-point z-scores use a fixed 2016-2025 daily archive baseline.
- `M` is the source model's bounded moisture factor: `clamp(30-day precipitation / 60 mm, 0, 1)` at that same cutoff.
- Current and prior-week rank calculations use identical formulas and a cutoff exactly seven days apart.
- `priority = F * W * (0.4 + 0.6 * (1 - M)) * C`.

## UI

- Extend the existing analytical layer panel with `Priority`, `Fuel`, `Weather W`, and `Moisture M` controls; retain the existing dark map, outlined panels, and monospace service labels.
- Each dynamic layer has a concise low-to-high legend and a source/cutoff label.
- The selected-cell section shows F, W, M, C, priority, and rank delta.
- Add a compact `Top zones` panel with rank, change, place, priority, and exposed population.
- On narrow screens, stack controls and ranking in a bottom sheet; map controls remain reachable and cards do not obscure the full map.

## Failure and honesty rules

- Static fuel and population/assets layers continue to work when the weather provider is unavailable.
- Dynamic layers and ranking show an unavailable state rather than a zero score or stale-looking substitute.
- A cell whose weather-point data is missing is excluded from dynamic ranking and rendered as no data for W/M/priority.
- The source-model constants are assumptions, not scientific calibration. The UI exposes the formula in a methodology disclosure instead of presenting it as an official warning.
- Labels describe these as weather and moisture factors used for prevention priority; they do not claim a fire forecast or official warning.
- Cache provider responses server-side. Preserve a timestamp and provider-reported coordinates for diagnostics.

## Scope

- No database, cron job, external SDK, budget-allocation model, historic fire catalogue, or point-level asset source.
- No change to DeepFire perimeter retrieval.

## Validation

- Unit-test factor bounds, complete-day moisture window, priority calculation, rank-delta direction, and missing-data handling.
- Validate provider-response decoding separately from map rendering.
- Run the existing analytics verification, targeted tests, lint, and typecheck/build.
