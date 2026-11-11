import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkerLoop } from "../src/loop.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("worker poll loop", () => {
  it("polls immediately and then on the configured interval", async () => {
    vi.useFakeTimers();
    const poll = vi.fn();
    const loop = new WorkerLoop({ poll, intervalMs: 1000 });

    loop.start();
    expect(poll).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(poll).toHaveBeenCalledTimes(2);

    await loop.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("does not overlap a slow poll", async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    let calls = 0;
    const poll = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? new Promise<void>((resolve) => {
            release = resolve;
          })
        : Promise.resolve();
    });
    const loop = new WorkerLoop({ poll, intervalMs: 1000 });

    loop.start();
    expect(poll).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(poll).toHaveBeenCalledTimes(1);

    release?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(poll).toHaveBeenCalledTimes(2);

    await loop.stop();
  });

  it("logs a failed poll and keeps polling", async () => {
    vi.useFakeTimers();
    const poll = vi.fn(() => {
      throw new Error("boom");
    });
    const logger = vi.fn();
    const loop = new WorkerLoop({ poll, intervalMs: 1000, logger });

    loop.start();
    expect(logger).toHaveBeenCalledWith("worker poll failed: Error: boom");

    await vi.advanceTimersByTimeAsync(1000);
    expect(poll).toHaveBeenCalledTimes(2);

    await loop.stop();
  });

  it("reports running state", async () => {
    const loop = new WorkerLoop({ poll: () => undefined });
    expect(loop.running).toBe(false);
    loop.start();
    expect(loop.running).toBe(true);
    await loop.stop();
    expect(loop.running).toBe(false);
  });
});
