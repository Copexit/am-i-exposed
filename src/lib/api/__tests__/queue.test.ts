import { describe, it, expect } from "vitest";
import { createApiQueue, isLocalInstance } from "../queue";

describe("createApiQueue", () => {
  it("processes requests in priority order", async () => {
    const queue = createApiQueue({ delayMs: 0, concurrency: 1 });
    const order: number[] = [];

    // Enqueue in reverse priority order
    const p3 = queue.enqueue(async () => { order.push(3); return 3; }, 3);
    const p1 = queue.enqueue(async () => { order.push(1); return 1; }, 1);
    const p2 = queue.enqueue(async () => { order.push(2); return 2; }, 2);
    const p0 = queue.enqueue(async () => { order.push(0); return 0; }, 0);

    await Promise.all([p0, p1, p2, p3]);

    // First request (p3) starts immediately, then priority order for rest
    expect(order[0]).toBe(3); // Already running when others were enqueued
    expect(order.slice(1)).toEqual([0, 1, 2]);
  });

  it("respects concurrency limit", async () => {
    const queue = createApiQueue({ delayMs: 0, concurrency: 2 });
    let maxConcurrent = 0;
    let current = 0;

    const tasks = Array.from({ length: 5 }, (_, i) =>
      queue.enqueue(async () => {
        current++;
        maxConcurrent = Math.max(maxConcurrent, current);
        await new Promise((r) => setTimeout(r, 10));
        current--;
        return i;
      }, 1),
    );

    await Promise.all(tasks);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("handles abort signal", async () => {
    const queue = createApiQueue({ delayMs: 0, concurrency: 1 });
    const controller = new AbortController();

    // Enqueue a slow task first
    const slow = queue.enqueue(
      () => new Promise((r) => setTimeout(() => r("slow"), 100)),
      1,
    );

    // Enqueue a task with abort signal - catch immediately to avoid unhandled rejection
    const abortable = queue.enqueue(
      async () => "should not run",
      2,
      controller.signal,
    ).catch((e) => e);

    // Abort before it gets to run
    controller.abort();

    await slow;
    const error = await abortable;
    expect(error).toBeInstanceOf(DOMException);
  });

  it("reports pending and active counts", async () => {
    const queue = createApiQueue({ delayMs: 0, concurrency: 1 });
    expect(queue.pending).toBe(0);
    expect(queue.active).toBe(0);
  });

  it("clears pending requests", async () => {
    const queue = createApiQueue({ delayMs: 0, concurrency: 1 });

    // Enqueue a slow task to block
    const slow = queue.enqueue(
      () => new Promise((r) => setTimeout(() => r("done"), 50)),
      1,
    );

    // Enqueue more that will be pending - catch immediately to avoid unhandled rejection
    const p1 = queue.enqueue(async () => "pending1", 1).catch((e) => e);
    const p2 = queue.enqueue(async () => "pending2", 1).catch((e) => e);

    queue.clear();

    await slow;
    const e1 = await p1;
    const e2 = await p2;
    expect(e1).toBeInstanceOf(DOMException);
    expect(e2).toBeInstanceOf(DOMException);
  });
});

describe("isLocalInstance", () => {
  it("detects relative paths", () => {
    expect(isLocalInstance("/api")).toBe(true);
    expect(isLocalInstance("/api/v1")).toBe(true);
  });

  it("detects localhost", () => {
    expect(isLocalInstance("http://localhost:3006")).toBe(true);
    expect(isLocalInstance("http://127.0.0.1:3006")).toBe(true);
  });

  it("detects private IPs", () => {
    expect(isLocalInstance("http://192.168.1.100:3006")).toBe(true);
    expect(isLocalInstance("http://10.0.0.1:3006")).toBe(true);
  });

  it("detects .local domains", () => {
    expect(isLocalInstance("http://umbrel.local:3006")).toBe(true);
  });

  it("rejects public URLs", () => {
    expect(isLocalInstance("https://mempool.space")).toBe(false);
    expect(isLocalInstance("https://blockstream.info")).toBe(false);
  });
});
