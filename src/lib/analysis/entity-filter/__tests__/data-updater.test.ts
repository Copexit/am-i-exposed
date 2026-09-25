import { describe, it, expect, vi, afterEach } from "vitest";
import { checkForFullDataUpdate, updateFullEntityData } from "../data-updater";
import type { AddressFilter } from "../types";
import type { ProgressCallback } from "../filter-loader";

const FULL_INDEX = "/data/entity-index-full.bin";
const FULL_BLOOM = "/data/entity-filter-full.bin";

type EtagReply = Record<string, { cached: boolean; updateAvailable: boolean }> | null;

/** Synchronous MessageChannel stand-in: port2.postMessage delivers to port1.onmessage. */
class FakeChannel {
  port1: { onmessage: ((e: { data: unknown }) => void) | null } = { onmessage: null };
  port2 = { postMessage: (data: unknown) => this.port1.onmessage?.({ data }) };
}

/** Install a fake service worker. `reply` undefined = worker never answers. */
function installWorker(reply: EtagReply | undefined) {
  const posted: unknown[] = [];
  const active = {
    postMessage: (msg: unknown, [port]: [FakeChannel["port2"]]) => {
      posted.push(msg);
      if (reply !== undefined) port.postMessage(reply);
    },
  };
  vi.stubGlobal("MessageChannel", FakeChannel);
  vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve({ active }) } });
  return posted;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("checkForFullDataUpdate", () => {
  it("asks the service worker to compare ETags for both full data files", async () => {
    const posted = installWorker({});
    await checkForFullDataUpdate();
    expect(posted).toEqual([{ type: "CHECK_DATA_ETAGS", paths: [FULL_INDEX, FULL_BLOOM] }]);
  });

  it("returns true when either file has a newer server version", async () => {
    installWorker({
      [FULL_INDEX]: { cached: true, updateAvailable: false },
      [FULL_BLOOM]: { cached: true, updateAvailable: true },
    });
    expect(await checkForFullDataUpdate()).toBe(true);

    installWorker({ [FULL_INDEX]: { cached: true, updateAvailable: true } });
    expect(await checkForFullDataUpdate()).toBe(true);
  });

  it("returns false when both cached files are current or not reported", async () => {
    installWorker({
      [FULL_INDEX]: { cached: true, updateAvailable: false },
      [FULL_BLOOM]: { cached: false, updateAvailable: false },
    });
    expect(await checkForFullDataUpdate()).toBe(false);
    installWorker({});
    expect(await checkForFullDataUpdate()).toBe(false);
  });

  it("returns false for a malformed (null) worker reply", async () => {
    installWorker(null);
    expect(await checkForFullDataUpdate()).toBe(false);
  });

  it("returns false without a service worker or an active registration", async () => {
    vi.stubGlobal("navigator", {});
    expect(await checkForFullDataUpdate()).toBe(false);
    vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve({ active: null }) } });
    expect(await checkForFullDataUpdate()).toBe(false);
  });

  it("returns false after a 10s timeout when the worker never answers", async () => {
    vi.useFakeTimers();
    installWorker(undefined);
    let settled: boolean | undefined;
    const p = checkForFullDataUpdate().then((v) => (settled = v));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toBe(false);
  });
});

describe("updateFullEntityData", () => {
  const fakeFilter: AddressFilter = {
    has: () => true,
    meta: { version: 1, addressCount: 1, fpr: 0, buildDate: "" },
  };

  it("deletes both cached files, then resets state, then reloads with progress", async () => {
    const order: string[] = [];
    vi.stubGlobal("caches", {
      open: (name: string) => {
        order.push(`open:${name}`);
        return Promise.resolve({
          delete: (p: string) => (order.push(`delete:${p}`), Promise.resolve(true)),
        });
      },
    });
    const progress = vi.fn();
    const reload = vi.fn((cb?: ProgressCallback) => {
      order.push("reload");
      expect(cb).toBe(progress);
      return Promise.resolve(fakeFilter);
    });

    const result = await updateFullEntityData(() => order.push("reset"), reload, progress);

    expect(result).toBe(fakeFilter);
    expect(order).toEqual([
      "open:ami-exposed-data",
      `delete:${FULL_INDEX}`,
      `delete:${FULL_BLOOM}`,
      "reset",
      "reload",
    ]);
  });

  it("still resets and reloads when the Cache API is unavailable or throws", async () => {
    const reset = vi.fn();
    const reload = vi.fn(() => Promise.resolve(null));
    // No `caches` global at all
    expect(await updateFullEntityData(reset, reload)).toBeNull();
    vi.stubGlobal("caches", { open: () => Promise.reject(new Error("SecurityError")) });
    await updateFullEntityData(reset, reload);
    expect(reset).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
