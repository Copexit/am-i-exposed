// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

type Mod = typeof import("../useUrlState");
const load = async (): Promise<Mod["useUrlState"]> => (await import("../useUrlState")).useUrlState;

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.resetModules(); // module-level network cache
});

describe("useUrlState", () => {
  it("defaults to mainnet", async () => {
    const useUrlState = await load();
    const { result } = renderHook(() => useUrlState());
    expect(result.current.network).toBe("mainnet");
  });

  it("sets the network in the URL and storage, and clears the param for mainnet", async () => {
    window.history.replaceState(null, "", "/#tx=abc");
    const useUrlState = await load();
    const { result } = renderHook(() => useUrlState());

    act(() => result.current.setNetwork("signet"));
    expect(result.current.network).toBe("signet");
    expect(window.location.search).toBe("?network=signet");
    expect(window.location.hash).toBe("#tx=abc");
    expect(localStorage.getItem("ami-network")).toBe("signet");

    act(() => result.current.setNetwork("mainnet"));
    expect(window.location.search).toBe("");
    expect(localStorage.getItem("ami-network")).toBe("mainnet");
  });

  it("prefers the URL param over storage and ignores invalid values", async () => {
    localStorage.setItem("ami-network", "signet");
    window.history.replaceState(null, "", "/?network=testnet4");
    let useUrlState = await load();
    expect(renderHook(() => useUrlState()).result.current.network).toBe("testnet4");

    vi.resetModules();
    window.history.replaceState(null, "", "/?network=bogus");
    useUrlState = await load();
    expect(renderHook(() => useUrlState()).result.current.network).toBe("signet");
  });

  it("migrates a retired testnet3 URL param and saved value to mainnet", async () => {
    localStorage.setItem("ami-network", "testnet3");
    window.history.replaceState(null, "", "/?network=testnet3&foo=1#tx=abc");
    const useUrlState = await load();
    expect(renderHook(() => useUrlState()).result.current.network).toBe("mainnet");
    expect(localStorage.getItem("ami-network")).toBeNull();
    expect(window.location.search).toBe("?foo=1");
    expect(window.location.hash).toBe("#tx=abc");
  });

  it("follows back/forward navigation", async () => {
    const useUrlState = await load();
    const { result } = renderHook(() => useUrlState());
    act(() => {
      window.history.replaceState(null, "", "/?network=signet");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.network).toBe("signet");
  });
});
