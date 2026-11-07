import { FixedClock } from "../../src/clock.js";
import { resolveTick, type ResolveTickResult } from "../../src/engine.js";
import type {
  ContentPack,
  Order,
  OrderPayloadMap,
  OrderType,
  WorldState,
} from "../../src/types.js";
import { testContent, testOrder, testPlayer, testWorldState } from "../fixtures.js";

export const TEST_CLOCK = new FixedClock("2026-11-07T20:00:00.000Z");
export const TEST_TICK = 5;

export { testContent, testOrder, testPlayer, testWorldState };

export function makeOrder<K extends OrderType>(
  type: K,
  payload: OrderPayloadMap[K],
  overrides: Partial<Order> = {},
): Order {
  return testOrder({ type, payload, ...overrides } as Partial<Order>);
}

export function runTick(
  state: WorldState,
  content: ContentPack = testContent(),
): ResolveTickResult {
  return resolveTick({ state, content });
}

export interface ScenarioOptions {
  content?: ContentPack;
  players?: number;
}

export function scenario(options: ScenarioOptions = {}): WorldState {
  const playerCount = options.players ?? 1;
  const players = Array.from({ length: playerCount }, (_, index) =>
    testPlayer({ id: `p${index + 1}`, name: `Player ${index + 1}`, plotId: `plot${index + 1}` }),
  );
  const plots = players.map((player, index) => ({
    id: player.plotId,
    playerId: player.id,
    regionId: "r1",
    siteX: index,
    siteY: 0,
    width: 12,
    height: 12,
    worldOwned: false,
  }));
  return testWorldState({ players, plots });
}

export function expectSameResolution(a: ResolveTickResult, b: ResolveTickResult): void {
  if (JSON.stringify(a.events) !== JSON.stringify(b.events)) {
    throw new Error("event sequences differ");
  }
  if (a.stateHash !== b.stateHash) {
    throw new Error(`state hashes differ: ${a.stateHash} != ${b.stateHash}`);
  }
}
