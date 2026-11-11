/**
 * Worker poll loop (spec §12, §14; M4.A01).
 *
 * The loop runs an injected poll immediately and then on a fixed interval. It
 * never overlaps polls: a slow poll is allowed to finish before the next one
 * starts, and a failed poll is logged without stopping the loop.
 */

export const DEFAULT_POLL_INTERVAL_MS = 60_000;

export interface WorkerLoopOptions {
  poll: () => Promise<void> | void;
  intervalMs?: number;
  logger?: (message: string) => void;
}

export class WorkerLoop {
  readonly #poll: () => Promise<void> | void;
  readonly #intervalMs: number;
  readonly #logger: (message: string) => void;
  #timer: ReturnType<typeof setInterval> | null = null;
  #inFlight: Promise<void> | null = null;
  #stopped = true;

  constructor(options: WorkerLoopOptions) {
    this.#poll = options.poll;
    this.#intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#logger = options.logger ?? (() => undefined);
  }

  get running(): boolean {
    return !this.#stopped;
  }

  async runOnce(): Promise<void> {
    if (this.#inFlight) {
      return this.#inFlight;
    }
    const current = (async () => {
      try {
        await this.#poll();
      } catch (error) {
        this.#logger(`worker poll failed: ${String(error)}`);
      }
    })();
    this.#inFlight = current;
    try {
      await current;
    } finally {
      if (this.#inFlight === current) {
        this.#inFlight = null;
      }
    }
  }

  start(): void {
    if (this.#timer) {
      return;
    }
    this.#stopped = false;
    void this.runOnce();
    this.#timer = setInterval(() => {
      void this.runOnce();
    }, this.#intervalMs);
    this.#timer.unref?.();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    await this.#inFlight;
  }
}
