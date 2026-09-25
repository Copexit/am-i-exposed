// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createLocalStorageStore } from "../createLocalStorageStore";

const KEY = "test-store";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("createLocalStorageStore", () => {
  it("returns the default when nothing is stored, and on the server", () => {
    const def = { n: 0 };
    const store = createLocalStorageStore(KEY, def);
    expect(store.getSnapshot()).toBe(def);
    expect(store.getServerSnapshot()).toBe(def);
  });

  it("returns a referentially stable snapshot while storage is unchanged", () => {
    localStorage.setItem(KEY, JSON.stringify({ n: 1 }));
    const store = createLocalStorageStore(KEY, { n: 0 });
    const a = store.getSnapshot();
    expect(a).toEqual({ n: 1 });
    expect(store.getSnapshot()).toBe(a);
    localStorage.setItem(KEY, JSON.stringify({ n: 2 }));
    expect(store.getSnapshot()).toEqual({ n: 2 });
  });

  it("set persists via the serializer and notifies subscribers", () => {
    const store = createLocalStorageStore<number>(KEY, 0, Number, String);
    const cb = vi.fn();
    const unsub = store.subscribe(cb);
    expect(store.set(7)).toBe(true);
    expect(localStorage.getItem(KEY)).toBe("7");
    expect(store.getSnapshot()).toBe(7);
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    store.set(8);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("set returns false and keeps the old value when storage throws", () => {
    const store = createLocalStorageStore<number>(KEY, 0);
    store.set(1);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(store.set(2)).toBe(false);
    expect(store.getSnapshot()).toBe(1);
  });

  it("remove clears storage, restores the default and notifies", () => {
    const store = createLocalStorageStore<string[]>(KEY, []);
    store.set(["a"]);
    const cb = vi.fn();
    store.subscribe(cb);
    store.remove();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(store.getSnapshot()).toEqual([]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default when storage access throws", () => {
    const def = { n: 0 };
    const store = createLocalStorageStore(KEY, def);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(store.getSnapshot()).toBe(def);
  });

  it("returns the default consistently when a valid value is replaced by corrupt data", () => {
    const def = { n: 0 };
    localStorage.setItem(KEY, JSON.stringify({ n: 1 }));
    const store = createLocalStorageStore(KEY, def);
    expect(store.getSnapshot()).toEqual({ n: 1 });
    localStorage.setItem(KEY, "{not json");
    // Consecutive calls must agree, or useSyncExternalStore sees a torn snapshot
    expect(store.getSnapshot()).toBe(def);
    expect(store.getSnapshot()).toBe(def);
  });
});
