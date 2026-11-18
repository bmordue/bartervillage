/**
 * Cosmetic goodwill badges (spec §8; M6.12).
 *
 * Goodwill is a score that players earn through gifts and help. Badges are a
 * purely decorative tier derived from that score: they never unlock recipes,
 * gate actions, move goods or affect production. Nothing here feeds back into
 * the order engine, so goodwill cannot become a currency.
 */

import type { BadgeDefinition, GoodwillConfig } from "./types.js";

/** Badges the player has earned, ordered from lowest to highest threshold. */
export function earnedBadges(score: number, config: GoodwillConfig): BadgeDefinition[] {
  return config.badges
    .filter((badge) => score >= badge.minScore)
    .sort((left, right) => left.minScore - right.minScore);
}

/** The currently displayed badge for a score, or `undefined` before any tier. */
export function currentBadge(score: number, config: GoodwillConfig): BadgeDefinition | undefined {
  const earned = earnedBadges(score, config);
  return earned[earned.length - 1];
}
