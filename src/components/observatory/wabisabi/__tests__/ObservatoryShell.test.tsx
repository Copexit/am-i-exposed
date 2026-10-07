// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import flowEnv from "@/lib/observatory/__tests__/fixtures/wabisator/flow-map-1d.json";
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
vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => ({ network: "mainnet", isUmbrel: false, apiReady: true }) }));
vi.mock("@/hooks/useChainTip", () => ({ useChainTip: () => null }));
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

const polled = <T,>(data: T | null, error: Error | null = null): Polled<T> => ({ data, error, loading: false, updatedAt: data ? 1_700_000_000_000 : null, refresh: vi.fn() });
const hooks = vi.hoisted(() => ({ flow: null as unknown, status: null as unknown, flowPeriods: [] as number[] }));
vi.mock("@/hooks/useWabisator", () => ({
  useFlowMap: (period: number) => { hooks.flowPeriods.push(period); return hooks.flow; },
  useCoordinatorsStatus: () => hooks.status,
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
    act(() => screen.getByRole("button", { name: "Kruw" }).click());
    expect(window.location.hash).toBe("#wabisabi");
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
