import { computeStateHash } from "./canonical.js";
import { EventLog } from "./events.js";
import { resolveOrder } from "./orders.js";
import type { Rng } from "./rng.js";
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
import { makeTickHeader } from "./versions.js";
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
      const outcome = resolveOrder({
        state,
        content,
        order,
        player,
        location,
        reachable,
        path,
      });
      if (outcome.ok) {
        order.status = "resolved";
        order.failureReason = null;
        events.emit("order_resolved", {
          orderId: order.id,
          playerId: player.id,
          orderType: order.type,
        });
      } else {
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
  refreshEnergy(state, input.content);
  const players = orderPlayers(state);
  resolvePlayerOrders(state, players, input.content, events);
  state.world.currentTick += 1;
  state.world.resolving = null;
  state.ready = [];
  state.claims = [];
  const stateHash = computeStateHash(hashableState(state));
  return { state, events: [...events.events], stateHash, header };
}
