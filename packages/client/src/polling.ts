/**
 * Client-side polling (spec §12; M5.A05).
 *
 * The API is plain REST with JSON, so the client polls every five seconds rather
 * than holding a socket open. Polls never overlap: the next one is scheduled only
 * after the previous one settles.
 */

export const POLL_INTERVAL_MS = 5000;

export interface PollerOptions<T> {
  /** Fetch one snapshot. Receives an abort signal so a stop cancels in-flight work. */
  fetchData: (signal: AbortSignal) => Promise<T>;
  onData: (data: T) => void;
  onError?: (error: unknown) => void;
  intervalMs?: number;
}

export interface Poller {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
  pollNow: () => Promise<void>;
}

export function createPoller<T>(options: PollerOptions<T>): Poller {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;

  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  const schedule = (): void => {
    if (!running) {
      return;
    }
    timer = setTimeout(() => {
      void poll();
    }, intervalMs);
  };

  const poll = async (): Promise<void> => {
    if (!running) {
      return;
    }

    const current = new AbortController();
    controller = current;

    try {
      const data = await options.fetchData(current.signal);
      if (running && !current.signal.aborted) {
        options.onData(data);
      }
    } catch (error) {
      if (running && !current.signal.aborted) {
        options.onError?.(error);
      }
    } finally {
      if (controller === current) {
        controller = undefined;
      }
      schedule();
    }
  };

  return {
    start() {
      if (running) {
        return;
      }
      running = true;
      void poll();
    },
    stop() {
      running = false;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      controller?.abort();
      controller = undefined;
    },
    isRunning() {
      return running;
    },
    async pollNow() {
      if (!running) {
        return;
      }
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      await poll();
    },
  };
}
