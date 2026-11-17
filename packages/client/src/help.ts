/**
 * Help flow helpers (M6.09).
 *
 * A helper can water, tend or feed on another player's plot. These helpers turn
 * a viewed plot into the chores worth offering and build the order draft that
 * queues the help action.
 */

import { content } from "@bartervillage/content";

import type { OrderDraft } from "./orders.js";
import type { PlotSnapshot } from "./plot.js";

export const HELP_CHORES = ["water", "tend", "feed"] as const;
export type HelpChore = (typeof HELP_CHORES)[number];

export const HELP_ENERGY_COST = content.energy.costs.help;
export const HELP_GOODWILL = content.goodwill.help;

export const HELP_LABELS: Record<HelpChore, string> = {
  water: "Water crops",
  tend: "Tend crops",
  feed: "Feed animals",
};

/** Build the order draft that helps with a chore on a host plot. */
export function createHelpOrder(targetPlotId: string, chore: HelpChore): OrderDraft {
  return {
    type: "help",
    payload: { targetPlotId, chore },
  };
}

/** Return the chores the host plot currently needs help with. */
export function availableHelpChores(plot: PlotSnapshot): HelpChore[] {
  const chores: HelpChore[] = [];
  if (plot.crops.some((crop) => !crop.failed && !crop.watered)) {
    chores.push("water");
  }
  if (plot.crops.some((crop) => !crop.failed && !crop.tended)) {
    chores.push("tend");
  }
  if (plot.animals.some((animal) => !animal.fed)) {
    chores.push("feed");
  }
  return chores;
}
