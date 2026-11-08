/**
 * Seasons and weather (spec §9, M7.01-M7.04).
 *
 * A season is 7 ticks and a year is 28 ticks. Weather is rolled from the tick's
 * seeded RNG so replays are reproducible.
 */

import type { Rng } from "./rng.js";
import { SEASONS, type Season, type Weather } from "./types.js";

export const TICKS_PER_SEASON = 7;
export const SEASONS_PER_YEAR = 4;
export const TICKS_PER_YEAR = TICKS_PER_SEASON * SEASONS_PER_YEAR;

export function seasonForTick(tick: number): Season {
  const index = Math.floor(tick / TICKS_PER_SEASON) % SEASONS_PER_YEAR;
  return SEASONS[index] as Season;
}

export function yearForTick(tick: number): number {
  return Math.floor(tick / TICKS_PER_YEAR) + 1;
}

export function isSeasonRollover(tick: number): boolean {
  return tick > 0 && tick % TICKS_PER_SEASON === 0;
}

interface WeatherWeight {
  weather: Weather;
  weight: number;
}

export function weatherWeights(season: Season): WeatherWeight[] {
  if (season === "winter") {
    return [
      { weather: "clear", weight: 35 },
      { weather: "rain", weight: 20 },
      { weather: "drought", weight: 5 },
      { weather: "frost", weight: 40 },
    ];
  }
  if (season === "autumn") {
    return [
      { weather: "clear", weight: 40 },
      { weather: "rain", weight: 30 },
      { weather: "drought", weight: 15 },
      { weather: "frost", weight: 15 },
    ];
  }
  if (season === "summer") {
    return [
      { weather: "clear", weight: 50 },
      { weather: "rain", weight: 20 },
      { weather: "drought", weight: 30 },
      { weather: "frost", weight: 0 },
    ];
  }
  return [
    { weather: "clear", weight: 45 },
    { weather: "rain", weight: 35 },
    { weather: "drought", weight: 15 },
    { weather: "frost", weight: 5 },
  ];
}

export function rollWeather(rng: Rng, season: Season): Weather {
  const weights = weatherWeights(season).filter((entry) => entry.weight > 0);
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.nextFloat() * total;
  for (const entry of weights) {
    roll -= entry.weight;
    if (roll < 0) {
      return entry.weather;
    }
  }
  return weights[weights.length - 1]?.weather ?? "clear";
}
