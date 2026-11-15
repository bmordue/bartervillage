/**
 * Unit tests for the five-second poller (M5.A05).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPoller, POLL_INTERVAL_MS } from "../src/polling.js";

describe("createPoller (M5.A05)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls immediately and then every five seconds", async () => {
    const fetchData = vi.fn(async () => 1);
    const onData = vi.fn();
    const poller = createPoller({ fetchData, onData });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchData).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetchData).toHaveBeenCalledTimes(2);
    expect(onData).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it("does not start a new poll while one is still in flight", async () => {
    let resolveFirst: ((value: number) => void) | undefined;
    const fetchData = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const poller = createPoller({ fetchData, onData: vi.fn() });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchData).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
    expect(fetchData).toHaveBeenCalledTimes(1);

    resolveFirst?.(1);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetchData).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it("stops polling and aborts in-flight work", async () => {
    let seen: AbortSignal | undefined;
    const fetchData = vi.fn(
      (signal: AbortSignal) =>
        new Promise<number>(() => {
          seen = signal;
        }),
    );
    const poller = createPoller({ fetchData, onData: vi.fn() });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(poller.isRunning()).toBe(true);

    poller.stop();
    expect(poller.isRunning()).toBe(false);
    expect(seen?.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(fetchData).toHaveBeenCalledTimes(1);
  });

  it("reports errors but keeps polling", async () => {
    const onData = vi.fn();
    const onError = vi.fn();
    const fetchData = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(7);
    const poller = createPoller({ fetchData, onData, onError });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onData).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(onData).toHaveBeenCalledWith(7);

    poller.stop();
  });

  it("is idempotent when started twice", async () => {
    const fetchData = vi.fn(async () => 1);
    const poller = createPoller({ fetchData, onData: vi.fn() });

    poller.start();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchData).toHaveBeenCalledTimes(1);

    poller.stop();
  });
});
