import { computeStateHash } from "./canonical.js";
import { advanceConstruction } from "./buildings.js";
import { advanceCrafting } from "./crafting.js";
import { advanceCrops, witherOutOfSeason } from "./crops.js";
import { appendMissedTickDefaults } from "./defaults.js";
import { EventLog } from "./events.js";
import { regrowWildNodes, resolveWildClaims } from "./forage.js";
import "./handlers.js";
import { discardOrderLock, preLockedItems } from "./locking.js";
import { resolveOrder } from "./orders.js";
import { runAnimalProduction } from "./animals.js";
import { expirePosts } from "./barter.js";
import { createRng, type Rng } from "./rng.js";
import type {
  AvatarPath,
  AvatarPathPoint,
  ContentPack,
  GameEvent,
  Order,
  Player,
  PlayerId,
  RegionId,
  TickHeader,
  WorldState,
} from "./types.js";
import { isSeasonRollover, rollWeather, seasonForTick, yearForTick } from "./seasons.js";
import { makeTickHeader, tickSeedParts } from "./versions.js";
import { releaseOrderLocks } from "./queue.js";
import { refreshEnergy, regionById } from "./world.js";

export interface ResolveTickInput {
  state: WorldState;
  content: ContentPack;
  header?: TickHeader;
  rng?: Rng;
}

export interface ResolveTickResult {
  state: WorldState;
  events: GameEvent[];
  stateHash: string;
  header: TickHeader;
}

/** Code-unit comparison; never uses locale-dependent collation. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function currentReadyPositions(state: WorldState): Map<PlayerId, number> {
  const positions = new Map<PlayerId, number>();
  for (const entry of state.ready) {
    if (entry.tick === state.world.currentTick) {
      positions.set(entry.playerId, entry.position);
    }
  }
  return positions;
}

/** Ready players by position, then unready players by player ID (spec §4.2). */
export function orderPlayers(state: WorldState): Player[] {
  const positions = currentReadyPositions(state);
  const byId = new Map(state.players.map((player) => [player.id, player]));
  const ready = [...positions.entries()]
    .map(([playerId, position]) => ({ playerId, position }))
    .filter((entry) => byId.has(entry.playerId))
    .sort((a, b) => a.position - b.position || compareIds(a.playerId, b.playerId));
  const unready = state.players
    .filter((player) => !positions.has(player.id))
    .sort((a, b) => compareIds(a.id, b.id));
  return [...ready.map((entry) => byId.get(entry.playerId) as Player), ...unready];
}

function ordersForPlayer(state: WorldState, player: Player): Order[] {
  return state.orders
    .filter(
      (order) =>
        order.playerId === player.id &&
        order.status === "queued" &&
        order.tick === state.world.currentTick,
    )
    .sort((a, b) => a.sequence - b.sequence || compareIds(a.id, b.id));
}

function playerHomeRegion(state: WorldState, player: Player): RegionId | null {
  const plot = state.plots.find((candidate) => candidate.id === player.plotId);
  return plot ? plot.regionId : null;
}

function pathPoint(state: WorldState, regionId: RegionId): AvatarPathPoint {
  const region = regionById(state, regionId);
  return { regionId, x: region?.x ?? 0, y: region?.y ?? 0 };
}

function buildAvatarPath(
  state: WorldState,
  player: Player,
  home: RegionId,
  visited: readonly RegionId[],
): AvatarPath {
  const via = visited.slice(0, -1).map((regionId) => pathPoint(state, regionId));
  return {
    playerId: player.id,
    tick: state.world.currentTick,
    from: pathPoint(state, home),
    via,
    to: pathPoint(state, home),
    returnedHome: true,
  };
}

export function resolvePlayerOrders(
  state: WorldState,
  players: readonly Player[],
  content: ContentPack,
  events: EventLog,
): void {
  for (const player of players) {
    const home = playerHomeRegion(state, player);
    if (!home) {
      continue;
    }
    const location = { regionId: home };
    const reachable = new Set<RegionId>([home]);
    const path: RegionId[] = [];
    for (const order of ordersForPlayer(state, player)) {
      const locked = preLockedItems(state, order.id);
      const outcome = resolveOrder({
        state,
        content,
        order,
        player,
        location,
        reachable,
        path,
        events,
        ...(locked ? { preLockedItems: locked } : {}),
      });
      if (outcome.ok) {
        discardOrderLock(state, order.id);
        order.status = "resolved";
        order.failureReason = null;
        events.emit("order_resolved", {
          orderId: order.id,
          playerId: player.id,
          orderType: order.type,
        });
      } else {
        releaseOrderLocks(state, order.id);
        order.status = "failed";
        order.failureReason = outcome.reason;
        events.emit("order_failed", {
          orderId: order.id,
          playerId: player.id,
          orderType: order.type,
          reason: outcome.reason ?? "unknown",
        });
      }
    }
    if (path.length > 0) {
      const trail = [...path, home];
      events.emit("avatar_path", {
        path: buildAvatarPath(state, player, home, trail),
      });
    }
  }
}

/** Strip scheduling data that is excluded from the replay state hash (spec §14). */
export function hashableState(state: WorldState): unknown {
  return {
    ...state,
    world: {
      ...state.world,
      nextDeadline: null,
      resolving: null,
    },
  };
}

export function resolveTick(input: ResolveTickInput): ResolveTickResult {
  const state = structuredClone(input.state);
  const header =
    input.header ??
    makeTickHeader({
      worldSeed: state.world.config.seed,
      tick: state.world.currentTick,
      generatorVersion: state.world.config.generatorVersion,
      contentVersion: state.world.config.contentVersion,
      rulesVersion: state.world.config.rulesVersion,
    });
  const events = new EventLog(header.tick);
  const rng = input.rng ?? createRng(tickSeedParts(header));
  refreshEnergy(state, input.content);

  const resolvedSeason = seasonForTick(state.world.currentTick);
  if (state.world.season !== resolvedSeason) {
    state.world.season = resolvedSeason;
    if (isSeasonRollover(state.world.currentTick)) {
      events.emit("season_change", {
        season: resolvedSeason,
        year: yearForTick(state.world.currentTick),
      });
    }
    witherOutOfSeason(state, input.content, resolvedSeason, events);
  }

  state.world.weather = rollWeather(rng.fork("weather"), state.world.season);
  events.emit("weather", { weather: state.world.weather, season: state.world.season });

  advanceCrops(state, input.content, rng.fork("crops"), events);
  runAnimalProduction(state, input.content, events);
  advanceConstruction(state, input.content, events);
  advanceCrafting(state, input.content, events);
  regrowWildNodes(state, events);
  expirePosts(state, events);

  const players = orderPlayers(state);
  const ready = currentReadyPositions(state);
  for (const player of players) {
    if (!ready.has(player.id)) {
      appendMissedTickDefaults(state, player, input.content);
    }
  }
  resolvePlayerOrders(state, players, input.content, events);
  resolveWildClaims(state, input.content, events);
  state.world.currentTick += 1;
  state.world.resolving = null;
  state.ready = [];
  state.claims = [];
  const stateHash = computeStateHash(hashableState(state));
  return { state, events: [...events.events], stateHash, header };
}
