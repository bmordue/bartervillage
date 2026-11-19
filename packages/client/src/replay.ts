/**
 * Client-side replay fetch and playback (spec §10; M5.C01).
 *
 * Fetches the latest tick replay via GET /replay/latest and plays events back
 * in recorded sequence order. Pure controller kept free of Preact so it can be
 * unit-tested in Node.
 */

import type { ArchivedEvent, EventType } from "@bartervillage/rules";

export const REPLAY_SCHEMA_VERSION = 1;

export interface TickReplayHeader {
  v: number;
  tick: number;
  worldSeed: string;
  generatorVersion: string;
  contentVersion: string;
  rulesVersion: string;
}

export interface TickReplayResponse {
  tick: number;
  header: TickReplayHeader;
  events: ArchivedEvent[];
}

interface RawTickReplayResponse {
  tick: number;
  header: TickReplayHeader;
  events: Array<{
    tick: number;
    sequence: number;
    type: EventType;
    payload: unknown;
    version: number;
  }>;
}

/** Fetch the latest tick replay. Throws on a non-2xx response. */
export async function fetchLatestReplay(
  baseUrl = "",
  worldId = "w1",
  signal?: AbortSignal,
): Promise<TickReplayResponse> {
  const response = await fetch(`${baseUrl}/replay/latest`, {
    headers: { "x-world-id": worldId },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`GET /replay/latest failed with ${response.status}`);
  }
  const body = (await response.json()) as RawTickReplayResponse;

  if (!body.header || body.header.v !== REPLAY_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported replay schema version ${String(body.header?.v)} (expected ${REPLAY_SCHEMA_VERSION})`,
    );
  }

  return {
    tick: body.tick,
    header: body.header,
    events: body.events.map((e) => ({
      tick: e.tick,
      sequence: e.sequence,
      version: 1,
      type: e.type,
      payload: e.payload,
    })) as ArchivedEvent[],
  };
}

export class ReplayPlayback {
  private readonly events: ArchivedEvent[];
  private cursor = 0;

  constructor(replay: TickReplayResponse) {
    this.events = replay.events;
  }

  get total(): number {
    return this.events.length;
  }

  get index(): number {
    return this.cursor;
  }

  get isDone(): boolean {
    return this.cursor >= this.events.length;
  }

  get current(): ArchivedEvent | undefined {
    return this.cursor === 0 ? undefined : this.events[this.cursor - 1];
  }

  get progress(): number {
    return this.events.length === 0 ? 0 : this.cursor / this.events.length;
  }

  reset(): void {
    this.cursor = 0;
  }

  /** Advance to the next event and return it, or undefined when finished. */
  next(): ArchivedEvent | undefined {
    if (this.isDone) {
      return undefined;
    }
    const event = this.events[this.cursor];
    if (!event) {
      return undefined;
    }
    this.cursor += 1;
    return event;
  }
}
