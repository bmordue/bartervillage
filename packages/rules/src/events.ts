/**
 * Deterministic event log builder (spec §10, §14.9).
 *
 * Sequence numbers are assigned in emission order. Finalization groups events
 * by phase before writing them, so callers must emit a whole phase before
 * starting the next one.
 */

import type { EventPayloadMap, EventType, GameEvent, Tick } from "./types.js";

export class EventLog {
  readonly tick: Tick;
  #nextSequence = 0;
  #events: GameEvent[] = [];

  constructor(tick: Tick) {
    this.tick = tick;
  }

  emit<K extends EventType>(type: K, payload: EventPayloadMap[K]): GameEvent {
    const event = {
      tick: this.tick,
      sequence: this.#nextSequence,
      version: 1,
      type,
      payload,
    } as GameEvent;
    this.#nextSequence += 1;
    this.#events.push(event);
    return event;
  }

  get events(): readonly GameEvent[] {
    return this.#events;
  }

  get size(): number {
    return this.#events.length;
  }
}

/** Sort archived events by (tick, sequence) before hashing or persisting. */
export function sortEvents(events: readonly GameEvent[]): GameEvent[] {
  return [...events].sort((a, b) => a.tick - b.tick || a.sequence - b.sequence);
}
