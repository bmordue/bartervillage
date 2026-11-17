/**
 * Help order handler (M2.A16).
 *
 * A player can help another player's plot by watering, feeding, or tending.
 * The helper pays the energy cost; the host receives the benefit (crop
 * marked watered/tended or animal fed). The helper earns goodwill.
 *
 * A chore can be completed only once per tick; contention is resolved by
 * queue order. A player cannot help on their own plot.
 */

import {
  orderFailed,
  orderSucceeded,
  registerOrderHandler,
  type OrderExecutionContext,
  type OrderOutcome,
} from "./orders.js";
import type { Chore } from "./types.js";
import { orderEnergyCost, plotOfPlayer, spendEnergy } from "./world.js";

interface HelpPayload {
  targetPlotId: string;
  chore: Chore;
  tile?: { x: number; y: number };
  animalId?: string;
}

function parseHelpPayload(payload: unknown): HelpPayload | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const p = payload as Record<string, unknown>;
  if (typeof p["targetPlotId"] !== "string") {
    return null;
  }
  const chore = p["chore"];
  if (chore !== "water" && chore !== "feed" && chore !== "tend") {
    return null;
  }
  const result: HelpPayload = { targetPlotId: p["targetPlotId"], chore };
  if (p["tile"] !== undefined) {
    const tile = p["tile"];
    if (typeof tile !== "object" || tile === null || Array.isArray(tile)) {
      return null;
    }
    const x = (tile as Record<string, unknown>)["x"];
    const y = (tile as Record<string, unknown>)["y"];
    if (typeof x !== "number" || typeof y !== "number") {
      return null;
    }
    result.tile = { x, y };
  }
  if (typeof p["animalId"] === "string") {
    result.animalId = p["animalId"];
  }
  return result;
}

function helpHandler(context: OrderExecutionContext): OrderOutcome {
  const payload = parseHelpPayload(context.order.payload);
  if (!payload) {
    return orderFailed("Invalid help payload");
  }

  const ownPlot = plotOfPlayer(context.state, context.player.id);
  if (ownPlot && ownPlot.id === payload.targetPlotId) {
    return orderFailed("Cannot help on your own plot");
  }

  if (!context.state.plots.some((plot) => plot.id === payload.targetPlotId)) {
    return orderFailed(`Target plot ${payload.targetPlotId} not found`);
  }

  const targetPlot = context.state.plots.find((plot) => plot.id === payload.targetPlotId);
  if (!targetPlot || targetPlot.playerId === null || targetPlot.worldOwned) {
    return orderFailed(`Target plot ${payload.targetPlotId} has no host`);
  }

  const cost = orderEnergyCost(context.content, "help");
  if (!spendEnergy(context.player, cost)) {
    return orderFailed(`Not enough energy to help (needs ${cost})`);
  }

  let affected = false;
  if (payload.chore === "water") {
    for (const crop of context.state.crops) {
      if (crop.plotId === payload.targetPlotId && !crop.failed && !crop.watered) {
        crop.watered = true;
        affected = true;
      }
    }
  } else if (payload.chore === "tend") {
    for (const crop of context.state.crops) {
      if (crop.plotId === payload.targetPlotId && !crop.failed && !crop.tended) {
        crop.tended = true;
        affected = true;
      }
    }
  } else {
    for (const animal of context.state.animals) {
      if (animal.plotId === payload.targetPlotId && !animal.fed) {
        animal.fed = true;
        affected = true;
      }
    }
  }

  if (!affected) {
    return orderFailed(`No ${payload.chore} target available on the host plot`);
  }

  const entry = context.state.goodwill.find((row) => row.playerId === context.player.id);
  const amount = context.content.goodwill.help;
  if (entry) {
    entry.score += amount;
  } else {
    context.state.goodwill.push({ playerId: context.player.id, score: amount });
  }

  context.events?.emit("help", {
    helperId: context.player.id,
    hostPlayerId: targetPlot.playerId,
    plotId: targetPlot.id,
    chore: payload.chore,
  });

  return orderSucceeded;
}

export function registerHelpHandlers(): void {
  registerOrderHandler("help", helpHandler);
}

registerHelpHandlers();
