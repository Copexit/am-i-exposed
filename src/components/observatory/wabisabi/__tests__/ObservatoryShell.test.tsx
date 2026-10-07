// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import flowEnv from "@/lib/observatory/__tests__/fixtures/wabisator/flow-map-1d.json";
import flow7dEnv from "@/lib/observatory/__tests__/fixtures/wabisator/flow-map-7d.json";
import { buildScene, replayProgress } from "@/lib/observatory/sky-model";
import statusEnv from "@/lib/observatory/__tests__/fixtures/wabisator/coordinators-status.json";
import summaryFixture from "@/lib/observatory/__tests__/fixtures/whirlpool-summary.json";
import chartsFixture from "@/lib/observatory/__tests__/fixtures/whirlpool-charts.json";
import type { CoordinatorsStatus, FlowMap } from "@/lib/observatory/wabisator-types";
import type { WhirlpoolCharts, WhirlpoolSummary } from "@/lib/observatory/types";
import type { Polled } from "@/hooks/useWabisator";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      let s = (opts?.defaultValue as string) ?? key;
      for (const [k, v] of Object.entries(opts ?? {})) s = s.replace(`{{${k}}}`, String(v));
      return s;
    },
    i18n: { language: "en" },
  }),
}));
vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => ({ network: "mainnet", isUmbrel: false, routeReady: true }) }));
vi.mock("@/hooks/useChainTip", () => ({ useChainTip: () => null }));
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

const polled = <T,>(data: T | null, error: Error | null = null): Polled<T> => ({ data, error, loading: false, updatedAt: data ? 1_700_000_000_000 : null, refresh: vi.fn() });
const hooks = vi.hoisted(() => ({ flow: null as unknown, status: null as unknown, flowPeriods: [] as number[], flowByPeriod: {} as Record<number, unknown> }));
vi.mock("@/hooks/useWabisator", () => ({
  useFlowMap: (period: number) => { hooks.flowPeriods.push(period); return hooks.flowByPeriod[period] ?? hooks.flow; },
  useCoordinatorsStatus: () => hooks.status,
  useVolumeHistory: () => ({ data: null, error: null, loading: true, updatedAt: null, refresh: () => {} }),
  useRounds: () => ({ data: null, error: null, loading: true, updatedAt: null, refresh: () => {} }),
}));
const whirlpoolFetch = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useObservatory", () => ({
  useObservatory: () => {
    whirlpoolFetch();
    return { whirlpool: { summary: summaryFixture as WhirlpoolSummary, charts: chartsFixture as WhirlpoolCharts, txs: null }, loading: false, error: null, lastUpdatedAt: null, refresh: () => {} };
  },
}));

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

import ObservatoryPage from "@/app/observatory/page";

beforeEach(() => {
  window.history.replaceState(null, "", "/observatory/");
  hooks.flow = polled(flowEnv.result as FlowMap);
  hooks.status = polled(statusEnv.result as CoordinatorsStatus);
  hooks.flowPeriods = [];
  hooks.flowByPeriod = {};
  whirlpoolFetch.mockClear();
});

describe("Observatory tab shell", () => {
  it("opens on WabiSabi first, with its sections in order and the period stats", () => {
    render(<ObservatoryPage />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["WabiSabi (Wasabi)", "Whirlpool (Ashigaru)"]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    const ids = [...document.querySelectorAll("section[id^=obs-]")].map((s) => s.id);
    expect(ids).toEqual(["obs-map", "obs-live", "obs-coordinator", "obs-flows"]);
    const nav = screen.getByRole("navigation", { name: "WabiSabi sections" });
    expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["#obs-map", "#obs-live", "#obs-coordinator", "#obs-flows"]);
    expect(screen.getByTestId("obs-stat-volume").textContent).toContain("862.75");
    expect(document.querySelector('a[href="https://wabisator.com"]')).toBeTruthy();
    // The Whirlpool tab is not mounted, so it fetches nothing.
    expect(whirlpoolFetch).not.toHaveBeenCalled();
    expect(screen.queryByText("Whirlpool pools")).toBeNull();
  });

  it("renders the Whirlpool content on #whirlpool, and switching tabs writes the hash", () => {
    window.history.replaceState(null, "", "/observatory/#whirlpool");
    render(<ObservatoryPage />);
    expect(screen.getByRole("tab", { name: "Whirlpool (Ashigaru)" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Whirlpool pools")).toBeTruthy();
    expect(document.querySelector("#obs-map")).toBeNull();
    act(() => screen.getByRole("tab", { name: "WabiSabi (Wasabi)" }).click());
    expect(window.location.hash).toBe("#wabisabi");
    expect(document.querySelector("#obs-map")).toBeTruthy();
  });

  it("follows the period and view in the hash: view=table shows the tables", () => {
    window.history.replaceState(null, "", "/observatory/#wabisabi&period=7&view=table");
    render(<ObservatoryPage />);
    expect(hooks.flowPeriods.at(-1)).toBe(7);
    expect(screen.getByRole("table", { name: /Coordinators/ })).toBeTruthy();
    expect(screen.getByRole("table", { name: /Remix flows/ })).toBeTruthy();
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Map" })); });
    expect(window.location.hash).toBe("#wabisabi&period=7");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("selecting a coordinator sets coordinator= and toggles off again", () => {
    render(<ObservatoryPage />);
    const kruw = screen.getByRole("button", { name: "Kruw" });
    act(() => kruw.click());
    expect(window.location.hash).toBe("#wabisabi&coordinator=kruw");
    expect(screen.getByRole("button", { name: "Kruw" }).getAttribute("aria-pressed")).toBe("true");
    expect(document.getElementById("obs-coord-kruw-title")?.textContent).toBe("Kruw");
    act(() => screen.getByRole("button", { name: "Kruw" }).click());
    expect(window.location.hash).toBe("#wabisabi");
    expect(document.getElementById("obs-coord-kruw-title")).toBeNull();
  });

  it("keeps the coordinator page mounted, with its chart range, while the next period loads", () => {
    window.history.replaceState(null, "", "/observatory/#wabisabi&coordinator=kruw");
    hooks.flowByPeriod[7] = polled<FlowMap>(null);
    render(<ObservatoryPage />);
    const range = () => screen.getByRole("group", { name: "Range" });
    act(() => { fireEvent.click(within(range()).getByRole("button", { name: "30 d" })); });
    act(() => { fireEvent.click(within(screen.getByRole("group", { name: "Period" })).getByRole("button", { name: "7 d" })); });
    expect(hooks.flowPeriods.at(-1)).toBe(7);
    expect(document.getElementById("obs-coord-kruw-title")?.textContent).toBe("Kruw");
    expect(within(range()).getByRole("button", { name: "30 d" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("kpi-volume").closest("dl")?.getAttribute("aria-busy")).toBe("true");
    // The map itself shows its loading state rather than the old period.
    expect(screen.getByText("Loading the map")).toBeTruthy();
  });

  it("does not leave the coordinator page dimmed when the next period fails to load", () => {
    window.history.replaceState(null, "", "/observatory/#wabisabi&coordinator=kruw");
    hooks.flowByPeriod[7] = polled<FlowMap>(null, new Error("down"));
    render(<ObservatoryPage />);
    act(() => { fireEvent.click(within(screen.getByRole("group", { name: "Period" })).getByRole("button", { name: "7 d" })); });
    expect(hooks.flowPeriods.at(-1)).toBe(7);
    expect(document.getElementById("obs-coord-kruw-title")?.textContent).toBe("Kruw");
    expect(screen.getByTestId("kpi-volume").closest("dl")?.getAttribute("aria-busy")).toBe("false");
  });

  describe("search", () => {
    const slider = () => screen.getByRole("slider", { name: "Replay position" });
    const search = (q: string) => {
      const input = screen.getByPlaceholderText("Search a CoinJoin txid or a date");
      act(() => {
        fireEvent.change(input, { target: { value: q } });
        fireEvent.submit(input.closest("form")!);
      });
    };
    const flow1 = flowEnv.result as FlowMap;
    const scene1 = buildScene(flow1, statusEnv.result as CoordinatorsStatus);
    let fetchSpy: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-07T08:00:00Z"));
      fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      Element.prototype.scrollIntoView = vi.fn();
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("mounts the flows; a found txid sets tx=, closes the panel and focuses the map's pinned card, with no request", async () => {
      render(<ObservatoryPage />);
      expect(screen.getAllByTestId("obs-flow-bars").length).toBe(2);
      const ev = scene1.events[10]!;
      search(ev.txid);
      expect(window.location.hash).toBe(`#wabisabi&tx=${ev.txid}`);
      expect(screen.queryByTestId("obs-search-result")).toBeNull();
      const card = document.getElementById("obs-event-card")!;
      expect(card.getAttribute("role")).toBe("group");
      // The playhead sits 1.5 s of replay before the CoinJoin, so its pulse plays.
      expect(Number(slider().getAttribute("aria-valuenow"))).toBe(Math.round(100 * Math.max(0, replayProgress(ev.t, scene1) - 1.5 / 60)));
      // The replay keeps playing from there while focus moves to the card.
      await waitFor(() => expect(document.activeElement).toBe(card));
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("a found txid from the table view returns to the map, and the seek applies once", () => {
      window.history.replaceState(null, "", "/observatory/#wabisabi&view=table");
      render(<ObservatoryPage />);
      const ev = scene1.events[60]!;
      search(ev.txid);
      expect(window.location.hash).toBe(`#wabisabi&tx=${ev.txid}`);
      const at = Math.round(100 * (replayProgress(ev.t, scene1) - 1.5 / 60));
      expect(at).toBeGreaterThan(10);
      expect(Number(slider().getAttribute("aria-valuenow"))).toBe(at);
      // Map -> table -> map: a fresh replay, not the old search position.
      act(() => screen.getByRole("button", { name: "Table" }).click());
      act(() => screen.getByRole("button", { name: "Map" }).click());
      expect(Number(slider().getAttribute("aria-valuenow"))).toBe(0);
    });

    it("an out-of-period date switches period and ends with the playhead at the searched time", () => {
      hooks.flowByPeriod[7] = polled(flow7dEnv.result as unknown as FlowMap);
      render(<ObservatoryPage />);
      search("2026-10-02");
      act(() => { fireEvent.click(screen.getByRole("button", { name: /Show the last 7 d/ })); });
      expect(hooks.flowPeriods.at(-1)).toBe(7);
      const scene7 = buildScene(flow7dEnv.result as unknown as FlowMap, null);
      expect(Number(slider().getAttribute("aria-valuenow"))).toBe(Math.round(100 * replayProgress(Date.UTC(2026, 9, 2) / 1000, scene7)));
      expect(screen.getByTestId("obs-search-result").dataset.state).toBe("in-period");
    });
  });

  it("renders gracefully for an unknown coordinator and a malformed txid, dropping the unknown key", () => {
    window.history.replaceState(null, "", "/observatory/#wabisabi&coordinator=nope&tx=zz");
    const before = window.history.length;
    const { container } = render(<ObservatoryPage />);
    expect(document.querySelector("#obs-map")).toBeTruthy();
    expect(window.location.hash).toBe("#wabisabi");
    expect(window.history.length).toBe(before);
    expect(container.querySelector("#obs-coordinator [aria-hidden='true'].rounded-xl")).toBeNull();
  });

  it("keeps the coordinator skeleton while the coordinators are still loading", () => {
    window.history.replaceState(null, "", "/observatory/#wabisabi&coordinator=kruw");
    hooks.flow = polled<FlowMap>(null);
    hooks.status = polled<CoordinatorsStatus>(null);
    const { container } = render(<ObservatoryPage />);
    expect(window.location.hash).toBe("#wabisabi&coordinator=kruw");
    expect(container.querySelector("#obs-coordinator [aria-hidden='true'].rounded-xl")).toBeTruthy();
  });

  it("shows skeletons while loading, and a calm error panel with retry when the map fails", () => {
    hooks.flow = polled<FlowMap>(null);
    hooks.status = polled<CoordinatorsStatus>(null);
    const { unmount } = render(<ObservatoryPage />);
    expect(screen.getByText("Loading the map")).toBeTruthy();
    expect(screen.queryByTestId("obs-stat-volume")?.querySelector("[class*='animate-pulse']")).toBeTruthy();
    unmount();
    const failed = polled<FlowMap>(null, new Error("down"));
    hooks.flow = failed;
    render(<ObservatoryPage />);
    act(() => screen.getByRole("button", { name: /Try again/ }).click());
    expect(failed.refresh).toHaveBeenCalledOnce();
  });
});
