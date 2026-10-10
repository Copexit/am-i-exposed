// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

let pathname = "/observatory/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { legacyObsRedirect, obsRouteTab, useObsState } from "../useObsState";

describe("observatory routes", () => {
  it("maps each tab route to its tab and the hub to none", () => {
    expect(obsRouteTab("/observatory/wabisabi/")).toBe("wabisabi");
    expect(obsRouteTab("/observatory/whirlpool")).toBe("whirlpool");
    expect(obsRouteTab("/observatory/p2p/")).toBe("p2p");
    expect(obsRouteTab("/observatory/")).toBeNull();
    expect(obsRouteTab("/observatory/nope/")).toBeNull();
    expect(obsRouteTab(null)).toBeNull();
  });

  it("moves old hub deep links to the tab route, keeping the rest of the hash", () => {
    expect(legacyObsRedirect("#p2p&cur=EUR&pm=sepa")).toBe("/observatory/p2p/#cur=EUR&pm=sepa");
    expect(legacyObsRedirect("#wabisabi&coordinator=kruw")).toBe("/observatory/wabisabi/#coordinator=kruw");
    expect(legacyObsRedirect("#whirlpool")).toBe("/observatory/whirlpool/");
    expect(legacyObsRedirect("")).toBeNull();
    expect(legacyObsRedirect("#period=7")).toBeNull();
  });
});

describe("useObsState", () => {
  beforeEach(() => {
    pathname = "/observatory/";
    window.history.replaceState(null, "", "/observatory/");
  });

  it("defaults to the WabiSabi map for the last 24 h without a hash", () => {
    const { result } = renderHook(() => useObsState());
    expect(result.current[0]).toEqual({ tab: "wabisabi", period: 1, coordinator: null, tx: null, view: "map", cur: null, side: "buy", venue: ["robosats", "mostro", "hodlhodl"], pm: null, amt: null, amtu: "fiat" });
  });

  it("takes the tab from the path, reads the hash and ignores malformed values", () => {
    pathname = "/observatory/whirlpool/";
    window.history.replaceState(null, "", "/observatory/whirlpool/#period=30&tx=zz&view=table");
    const { result } = renderHook(() => useObsState());
    expect(result.current[0]).toMatchObject({ tab: "whirlpool", period: 30, tx: null, view: "table" });
  });

  it("writes patches to the hash, pushing an entry for period and view", () => {
    const { result } = renderHook(() => useObsState());
    const before = window.history.length;
    act(() => result.current[1]({ period: 7 }));
    expect(window.location.hash).toBe("#period=7");
    expect(result.current[0].period).toBe(7);
    act(() => result.current[1]({ view: "table" }));
    expect(window.location.hash).toBe("#period=7&view=table");
    expect(window.history.length).toBe(before + 2);
  });

  it("replaces the entry for coordinator and tx changes", () => {
    const { result } = renderHook(() => useObsState());
    act(() => result.current[1]({ period: 7 }));
    const before = window.history.length;
    act(() => result.current[1]({ coordinator: "kruw" }));
    act(() => result.current[1]({ tx: "a".repeat(64) }));
    expect(window.location.hash).toBe(`#period=7&coordinator=kruw&tx=${"a".repeat(64)}`);
    expect(window.history.length).toBe(before);
    act(() => result.current[1]({ coordinator: null, tx: null }));
    expect(window.location.hash).toBe("#period=7");
  });

  it("replaces the entry for P2P market selections", () => {
    pathname = "/observatory/p2p/";
    window.history.replaceState(null, "", "/observatory/p2p/");
    const { result } = renderHook(() => useObsState());
    expect(result.current[0].tab).toBe("p2p");
    const before = window.history.length;
    act(() => result.current[1]({ cur: "BRL" }));
    act(() => result.current[1]({ side: "sell", venue: ["mostro"] }));
    expect(window.location.hash).toBe("#cur=BRL&side=sell&venue=mostro");
    act(() => result.current[1]({ pm: "pix" }));
    expect(window.location.hash).toBe("#cur=BRL&side=sell&venue=mostro&pm=pix");
    expect(result.current[0].pm).toBe("pix");
    expect(window.history.length).toBe(before);
  });

  it("restores state on back and forward", async () => {
    const { result } = renderHook(() => useObsState());
    act(() => result.current[1]({ period: 7 }));
    act(() => result.current[1]({ period: 30 }));
    act(() => window.history.back());
    await waitFor(() => expect(result.current[0].period).toBe(7));
    act(() => window.history.forward());
    await waitFor(() => expect(result.current[0].period).toBe(30));
  });
});
