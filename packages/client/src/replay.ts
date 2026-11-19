/**
 * Client-side replay fetch and playback (spec §10; M5.C01).
 *
 * Fetches the latest tick replay via GET /replay/latest and exposes the
 * parsed events in sequence order for playback in the UI (M5.C02).
 */

import type { ArchivedEvent, EventType } from "@bartervillage/rules";

export interface TickReplayHeader {
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

export type ReplayState = "idle" | "playing" | "paused" | "done";

export interface ReplayPlayerProps {
  replay: TickReplayResponse;
  onEvent: (event: ArchivedEvent) => void;
  tickInterval?: number;
}

export class ReplayPlayer {
  private replay: TickReplayResponse;
  private index = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private state: ReplayState = "idle";
  private tickInterval: number;
  private onEvent: (event: ArchivedEvent) => void;

  constructor(props: ReplayPlayerProps) {
    this.replay = props.replay;
    this.onEvent = props.onEvent;
    this.tickInterval = props.tickInterval ?? 500;
  }

  load(replay: TickReplayResponse): void {
    this.stop();
    this.replay = replay;
    this.index = 0;
    this.state = "idle";
  }

  play(): void {
    if (this.state === "playing") return;
    this.state = "playing";
    this.tick();
  }

  pause(): void {
    this.state = "paused";
    this.stopTimer();
  }

  stop(): void {
    this.stopTimer();
    this.index = 0;
    this.state = "idle";
  }

  get events(): ArchivedEvent[] {
    return this.replay.events;
  }

  get currentEvent(): ArchivedEvent | undefined {
    return this.replay.events[this.index] ?? undefined;
  }

  get progress(): number {
    const events = this.events;
    return events.length === 0 ? 0 : this.index / events.length;
  }

  get isPlaying(): boolean {
    return this.state === "playing";
  }

  private tick(): void {
    this.stopTimer();
    if (this.state !== "playing") return;

    const events = this.events;
    if (this.index >= events.length) {
      this.state = "done";
      return;
    }

    const event = events[this.index];
    if (!event) return;
    this.index += 1;
    this.onEvent(event);
    this.timer = setTimeout(() => this.tick(), this.tickInterval);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
