/**
 * Ready state (spec §4.2, M2.A07-M2.A09).
 *
 * Positions are unique per tick and increase monotonically. Un-readying
 * removes the entry, so readying again takes a fresh position at the back.
 */

import type { PlayerId, ReadyEntry, Tick, WorldState } from "./types.js";

export function isReady(state: WorldState, playerId: PlayerId, tick: Tick): boolean {
  return state.ready.some((entry) => entry.playerId === playerId && entry.tick === tick);
}

export function readyEntry(
  state: WorldState,
  playerId: PlayerId,
  tick: Tick,
): ReadyEntry | undefined {
  return state.ready.find((entry) => entry.playerId === playerId && entry.tick === tick);
}

export function nextReadyPosition(state: WorldState, tick: Tick): number {
  let max = 0;
  for (const entry of state.ready) {
    if (entry.tick === tick && entry.position > max) {
      max = entry.position;
    }
  }
  return max + 1;
}

export function ready(state: WorldState, playerId: PlayerId, tick: Tick): ReadyEntry {
  const existing = readyEntry(state, playerId, tick);
  if (existing) {
    return existing;
  }
  const entry: ReadyEntry = {
    playerId,
    tick,
    position: nextReadyPosition(state, tick),
  };
  state.ready.push(entry);
  return entry;
}

export function unready(state: WorldState, playerId: PlayerId, tick: Tick): boolean {
  const index = state.ready.findIndex(
    (entry) => entry.playerId === playerId && entry.tick === tick,
  );
  if (index < 0) {
    return false;
  }
  state.ready.splice(index, 1);
  return true;
}
