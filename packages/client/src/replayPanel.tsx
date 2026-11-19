/**
 * Preact replay playback panel (spec §10; M5.C01).
 *
 * Renders the fetched tick replay with play/pause/step controls and lists the
 * events in recorded sequence order.
 */

import { useEffect, useRef, useState } from "preact/hooks";

import { ReplayPlayback, type TickReplayResponse } from "./replay.js";
import { Panel } from "./panel.js";
import type { ArchivedEvent } from "@bartervillage/rules";

export interface ReplayPanelProps {
  replay?: TickReplayResponse;
}

function describeEvent(event: ArchivedEvent | undefined): string {
  if (!event) {
    return "—";
  }
  return `${event.type} (seq ${event.sequence})`;
}

function describePayload(event: ArchivedEvent | undefined): string {
  if (!event || !event.payload || typeof event.payload !== "object") {
    return "none";
  }
  const keys = Object.keys(event.payload as Record<string, unknown>);
  return keys.length > 0 ? keys.join(", ") : "none";
}

/** Titled panel that fetches-free renders playback state for a tick replay. */
export function ReplayPanel({ replay }: ReplayPanelProps) {
  const playbackRef = useRef<ReplayPlayback | null>(null);
  const [tick, setTick] = useState(0);
  const [finished, setFinished] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!replay) {
      return;
    }
    const playback = new ReplayPlayback(replay);
    playbackRef.current = playback;
    playback.reset();
    setTick(replay.tick);
    setFinished(false);
    setPlaying(false);
  }, [replay]);

  useEffect(() => {
    if (!playing || !replay) {
      return;
    }
    const interval = setInterval(() => {
      const playback = playbackRef.current;
      const event = playback?.next();
      if (event) {
        setFinished(false);
      } else {
        setFinished(true);
        setPlaying(false);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [playing, replay]);

  const playback = playbackRef.current;
  const events = replay?.events ?? [];
  const current = playback?.current;
  const progress = playback ? playback.progress : 0;

  const togglePlay = (): void => {
    if (!replay) {
      return;
    }
    if (finished) {
      playbackRef.current?.reset();
      setFinished(false);
      if (playing) {
        return;
      }
    }
    setPlaying((prev) => !prev);
  };

  const stepForward = (): void => {
    const next = playbackRef.current?.next();
    if (next) {
      setFinished(false);
    }
  };

  const stop = (): void => {
    playbackRef.current?.reset();
    setFinished(false);
    setPlaying(false);
  };

  if (!replay) {
    return (
      <Panel title="Replay">
        <p class="empty-state">No replay data available. Wait for the tick to resolve.</p>
      </Panel>
    );
  }

  return (
    <Panel title={`Replay (tick ${tick})`}>
      <div class="replay-controls">
        <button type="button" class="replay-btn" onClick={togglePlay}>
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" class="replay-btn replay-btn-step" onClick={stepForward}>
          Step
        </button>
        <button type="button" class="replay-btn replay-btn-stop" onClick={stop}>
          Stop
        </button>
      </div>
      <div class="replay-progress">
        <span>{`Tick ${tick}`}</span>
        <progress value={progress * 100} max={100} />
        <span>{`${Math.round(progress * 100)}%`}</span>
      </div>
      <div class="replay-meta">
        <p>{`Schema v${replay.header.v} · tick ${replay.header.tick}`}</p>
        <p>
          {`Seed ${replay.header.worldSeed} · gen ${replay.header.generatorVersion} · content ${replay.header.contentVersion} · rules ${replay.header.rulesVersion}`}
        </p>
      </div>
      <div class="replay-event-info">
        <p>{`Events consumed: ${playback?.index ?? 0} / ${events.length}`}</p>
        <p>{`Current: ${describeEvent(current)}`}</p>
        <p>{`Payload keys: ${describePayload(current)}`}</p>
      </div>
      <div class="replay-events-list">
        <p>Events:</p>
        <ul>
          {events.map((event) => (
            <li key={event.sequence} class="replay-event">
              {describeEvent(event)}
            </li>
          ))}
        </ul>
      </div>
      {finished ? <p class="replay-done">Replay finished.</p> : null}
    </Panel>
  );
}
