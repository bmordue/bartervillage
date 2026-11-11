/**
 * Wild-node regrowth, forage/fish claims and shared claim resolution
 * (spec §4.3, §5, §6.2, §13, §14.6).
 *
 * Forage and fish claims reserve energy and record a `WildClaim` during the
 * player order phase. Yields are applied later, after every player has taken
 * their turn, so the claimant set is fixed before any share is computed.
 *
 * Fishing at a player's own dock is private (M2.C09): it spends energy and adds
 * the catch during the player's turn, so it never enters the shared claim set.
 * Fishing at a shared water node uses the same claim-and-split rule as foraging.
 */

import type { EventLog } from "./events.js";
import { addItems } from "./inventory.js";
import {
  orderFailed,
  orderSucceeded,
  registerOrderHandler,
  type OrderExecutionContext,
  type OrderOutcome,
} from "./orders.js";
import type {
  BuildingId,
  ContentPack,
  FishPayload,
  NodeId,
  Player,
  PlayerId,
  WildClaim,
  WildNode,
  WorldState,
} from "./types.js";
import { freeCapacity, orderEnergyCost, playerById, plotOfPlayer, spendEnergy } from "./world.js";

/** Code-unit comparison; never uses locale-dependent collation. */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedNodes(state: WorldState): WildNode[] {
  return [...state.wildNodes].sort((a, b) => compareCodeUnits(a.id, b.id));
}

/**
 * Regrow every wild node by its `regrowRate`, capped at `capacity`, in stable
 * node-id order. Emit `node_regrown` only for nodes whose amount increased.
 */
export function regrowWildNodes(state: WorldState, events: EventLog): void {
  for (const node of sortedNodes(state)) {
    const next = Math.max(0, Math.min(node.capacity, node.amount + node.regrowRate));
    if (next > node.amount) {
      node.amount = next;
      events.emit("node_regrown", {
        nodeId: node.id,
        resource: node.resource,
        amount: node.amount,
      });
    } else if (next < node.amount) {
      // Keep the node within [0, capacity] even if the stored amount was out of
      // bounds. A clamp is not regrowth, so it emits no event.
      node.amount = next;
    }
  }
}

/** Even split of a node yield, with the remainder staying on the node. */
export function splitShare(nodeYield: number, claimantCount: number): number {
  if (claimantCount <= 0 || nodeYield <= 0) {
    return 0;
  }
  return Math.floor(nodeYield / claimantCount);
}

interface ValidClaim {
  node: WildNode;
  cost: number;
}

/**
 * Positional/availability helper. The full claim check also needs content for
 * energy cost and storage capacity, so it lives in the order handlers.
 */
export function canForageNode(state: WorldState, nodeId: NodeId, player: Player): boolean {
  const node = state.wildNodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.amount < 1) {
    return false;
  }
  const plot = plotOfPlayer(state, player.id);
  if (!plot || plot.regionId !== node.regionId) {
    return false;
  }
  return !state.claims.some(
    (claim) =>
      claim.playerId === player.id &&
      claim.nodeId === node.id &&
      claim.tick === state.world.currentTick,
  );
}

function regionHasWater(state: WorldState, regionId: string): boolean {
  return state.tiles.some((tile) => tile.regionId === regionId && tile.type === "water");
}

function isFishable(state: WorldState, node: WildNode): boolean {
  return node.resource === "fish" || regionHasWater(state, node.regionId);
}

/**
 * Validate a claim without mutating state. Returns a failure reason string or
 * the node and energy cost to reserve.
 */
function validateClaim(
  context: OrderExecutionContext,
  nodeId: NodeId,
  cost: number,
  fishing: boolean,
): ValidClaim | string {
  const { state, player } = context;
  const node = state.wildNodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return `Unknown wild node ${nodeId}`;
  }
  if (node.regionId !== context.location.regionId) {
    return `Player is not in region ${node.regionId}`;
  }
  if (fishing && !isFishable(state, node)) {
    return `Wild node ${nodeId} is not a fishing spot`;
  }
  if (node.amount < 1) {
    return `Wild node ${nodeId} is depleted`;
  }
  if (player.energy < cost) {
    return `Not enough energy for ${fishing ? "fishing" : "foraging"} (needs ${cost})`;
  }
  if (freeCapacity(state, context.content, player.plotId) <= 0) {
    return "No free storage for the claim";
  }
  const alreadyClaimed = state.claims.some(
    (claim) =>
      claim.playerId === player.id &&
      claim.nodeId === node.id &&
      claim.tick === state.world.currentTick,
  );
  if (alreadyClaimed) {
    return `Player already claimed wild node ${nodeId} this tick`;
  }
  return { node, cost };
}

/** Private dock catch per fishing order (spec §6.2; v1 tuning constant). */
export const DOCK_FISH_YIELD = 1;

/**
 * Dock fishing is private and has no split: the catch is added to the owner's
 * storage during their turn instead of entering the shared claim set.
 */
function handleDockFishing(context: OrderExecutionContext, buildingId: BuildingId): OrderOutcome {
  const { state, content, player } = context;
  const plot = plotOfPlayer(state, player.id);
  if (!plot) {
    return orderFailed("Player has no plot");
  }
  const dock = state.buildings.find(
    (building) =>
      building.id === buildingId && building.type === "dock" && building.plotId === plot.id,
  );
  if (!dock) {
    return orderFailed(`Unknown or inaccessible dock ${buildingId}`);
  }
  if (dock.constructionKind !== null) {
    return orderFailed("Dock is not yet complete");
  }
  if (dock.level < 1) {
    return orderFailed("Dock must be at least level 1");
  }
  const cost = orderEnergyCost(content, "fish");
  if (player.energy < cost) {
    return orderFailed(`Not enough energy for dock fishing (needs ${cost})`);
  }
  if (freeCapacity(state, content, plot.id) < DOCK_FISH_YIELD) {
    return orderFailed("No free storage for fish");
  }
  spendEnergy(player, cost);
  addItems(state, content, plot.id, [{ item: "fish", quantity: DOCK_FISH_YIELD }]);
  return orderSucceeded;
}

function makeClaimHandler(fishing: boolean) {
  return (context: OrderExecutionContext): OrderOutcome => {
    const payload = context.order.payload as FishPayload;
    if (fishing && payload.buildingId !== undefined) {
      return handleDockFishing(context, payload.buildingId);
    }
    const orderType = fishing ? "fish" : "forage";
    if (payload.nodeId === undefined) {
      return orderFailed(`Missing wild node for ${orderType}`);
    }
    const cost = orderEnergyCost(context.content, orderType);
    const validation = validateClaim(context, payload.nodeId, cost, fishing);
    if (typeof validation === "string") {
      return orderFailed(validation);
    }
    if (!spendEnergy(context.player, validation.cost)) {
      return orderFailed(`Not enough energy for ${orderType} (needs ${validation.cost})`);
    }
    context.state.claims.push({
      playerId: context.player.id,
      nodeId: validation.node.id,
      tick: context.state.world.currentTick,
      sequence: context.order.sequence,
    });
    return orderSucceeded;
  };
}

/** Register the `forage` and `fish` order handlers. */
export function registerForageHandlers(): void {
  registerOrderHandler("forage", makeClaimHandler(false));
  registerOrderHandler("fish", makeClaimHandler(true));
}

function sortClaims(claims: readonly WildClaim[]): WildClaim[] {
  return [...claims].sort(
    (a, b) =>
      a.tick - b.tick || a.sequence - b.sequence || compareCodeUnits(a.playerId, b.playerId),
  );
}

/** Keep the first claim per player while preserving deterministic claim order. */
function uniqueClaimants(claims: readonly WildClaim[]): WildClaim[] {
  const seen = new Set<PlayerId>();
  const unique: WildClaim[] = [];
  for (const claim of claims) {
    if (!seen.has(claim.playerId)) {
      seen.add(claim.playerId);
      unique.push(claim);
    }
  }
  return unique;
}

/**
 * Apply this tick's claim shares. Each claimant gets
 * `floor(nodeYield / claimantCount)` units in claim order, capped by free
 * storage; overflow stays on the node. Zero shares still consume the energy
 * already reserved by the handler.
 */
export function resolveWildClaims(state: WorldState, content: ContentPack, events: EventLog): void {
  const tick = state.world.currentTick;
  const pending = state.claims.filter((claim) => claim.tick === tick);

  if (pending.length > 0) {
    const claimsByNode = new Map<NodeId, WildClaim[]>();
    for (const claim of pending) {
      const group = claimsByNode.get(claim.nodeId);
      if (group) {
        group.push(claim);
      } else {
        claimsByNode.set(claim.nodeId, [claim]);
      }
    }

    const nodesById = new Map(state.wildNodes.map((node) => [node.id, node]));
    const nodeIds = [...claimsByNode.keys()].sort(compareCodeUnits);

    for (const nodeId of nodeIds) {
      const node = nodesById.get(nodeId);
      if (!node) {
        continue;
      }
      const claimants = uniqueClaimants(sortClaims(claimsByNode.get(nodeId) ?? []));
      if (claimants.length === 0) {
        continue;
      }
      const share = splitShare(node.amount, claimants.length);
      const before = node.amount;

      for (const claim of claimants) {
        const player = playerById(state, claim.playerId);
        if (!player) {
          continue;
        }
        const plot = plotOfPlayer(state, player.id);
        if (!plot) {
          continue;
        }
        const capacity = freeCapacity(state, content, plot.id);
        const applied = Math.min(share, capacity, node.amount);
        if (applied <= 0) {
          continue;
        }
        addItems(state, content, plot.id, [{ item: node.resource, quantity: applied }]);
        node.amount -= applied;
      }

      if (before > 0 && node.amount === 0) {
        events.emit("node_depleted", {
          nodeId: node.id,
          resource: node.resource,
          amount: 0,
        });
      }
    }
  }

  state.claims = state.claims.filter((claim) => claim.tick !== tick);
}
