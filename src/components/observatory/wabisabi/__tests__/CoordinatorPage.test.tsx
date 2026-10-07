// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import flowEnv from "@/lib/observatory/__tests__/fixtures/wabisator/flow-map-7d.json";
import statusEnv from "@/lib/observatory/__tests__/fixtures/wabisator/coordinators-status.json";
import historyEnv from "@/lib/observatory/__tests__/fixtures/wabisator/volume-history.json";
import roundsEnv from "@/lib/observatory/__tests__/fixtures/wabisator/rounds-kruw.json";
import type { CoordinatorsStatus, FlowMap, RoundsPage, VolumeHistory } from "@/lib/observatory/wabisator-types";
import type { Polled } from "@/hooks/useWabisator";
import { buildScene } from "@/lib/observatory/sky-model";
import { volumeSeries } from "@/lib/observatory/coordinator-page";

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
// jsdom has no layout: give the chart a size so its marks and tooltip render.
vi.mock("@visx/responsive", () => ({
  ParentSize: ({ children }: { children: (s: { width: number; height: number }) => React.ReactNode }) => children({ width: 800, height: 260 }),
}));

const polled = <T,>(data: T | null): Polled<T> => ({ data, error: null, loading: !data, updatedAt: data ? 1 : null, refresh: vi.fn() });
const hooks = vi.hoisted(() => ({ history: null as unknown, rounds: null as unknown, roundsCalls: [] as [string | null, number][] }));
vi.mock("@/hooks/useWabisator", () => ({
  useVolumeHistory: () => hooks.history,
  useRounds: (key: string | null, page: number) => { hooks.roundsCalls.push([key, page]); return hooks.rounds; },
}));

import { CoordinatorPage } from "../CoordinatorPage";

const flow = flowEnv.result as unknown as FlowMap;
const status = statusEnv.result as CoordinatorsStatus;
const history = historyEnv.result as unknown as VolumeHistory;
const rounds = roundsEnv.result as unknown as RoundsPage;
const scene = buildScene(flow, status);
const kruwStatus = status.Coordinators.find((c) => c.Key === "kruw")!;

const media = { mobile: false, listeners: new Set<() => void>() };
const setMobile = (mobile: boolean) => {
  media.mobile = mobile;
  window.matchMedia = ((q: string) => ({
    matches: media.mobile && q.includes("max-width"),
    addEventListener: (_: string, cb: () => void) => media.listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => media.listeners.delete(cb),
  })) as unknown as typeof window.matchMedia;
  for (const cb of [...media.listeners]) cb();
};

const renderPage = (key = "kruw", onClose = vi.fn()) =>
  render(<CoordinatorPage coordinatorKey={key} scene={scene} flow={flow} status={status.Coordinators.find((c) => c.Key === key) ?? null} onClose={onClose} />);

beforeEach(() => {
  media.listeners.clear();
  hooks.history = polled(history);
  hooks.rounds = polled(rounds);
  hooks.roundsCalls = [];
  setMobile(false);
});
afterEach(cleanup);

describe("CoordinatorPage", () => {
  it("renders the Kruw header and KPIs from flow-map and history", () => {
    // Cheap queries here: this first render also pays the warm-up, and getByRole walks the whole tree.
    const { container } = renderPage();
    expect(document.getElementById("obs-coord-kruw-title")?.tagName).toBe("H3");
    expect(document.getElementById("obs-coord-kruw-title")?.textContent).toBe("Kruw");
    expect(screen.getByText(kruwStatus.Fees)).toBeTruthy();
    expect(container.querySelector('a[target="_blank"]')?.getAttribute("href")).toBe(kruwStatus.ReadMore);
    expect(screen.getByTestId("kpi-volume").textContent).toContain("6,637.60");
    expect(screen.getByTestId("kpi-coinjoins").textContent).toContain("460");
    expect(screen.getByTestId("kpi-fresh").textContent).toContain("656.06");
    expect(screen.getByTestId("kpi-remixIn").textContent).toContain("23.81");
    expect(screen.getByTestId("kpi-remixOut").textContent).toContain("2.88");
    expect(screen.getByTestId("kpi-internal").textContent).toContain("5,866.76");
    expect(screen.getByTestId("kpi-anonset").textContent).toMatch(/\d/);
    expect(screen.getByTestId("kpi-allTime").textContent).toContain("602,915.59");
    expect(screen.getByTestId("kpi-allTime").textContent).toContain("3,117.56");
  });

  it("shows skeletons in the history tiles until the history loads", () => {
    hooks.history = polled<VolumeHistory>(null);
    renderPage();
    expect(screen.getByTestId("kpi-allTime").querySelector("[class*='animate-pulse']")).toBeTruthy();
    expect(screen.getByTestId("kpi-volume").querySelector("[class*='animate-pulse']")).toBeNull();
  });

  it("switches the chart range, changing the series length", () => {
    renderPage();
    const chart = screen.getByTestId("volume-chart");
    const len = (r: "30d" | "90d" | "1y" | "all") => String(volumeSeries("kruw", history, r, history.UpdatedAt.slice(0, 10)).length);
    expect(chart.getAttribute("data-points")).toBe(len("1y"));
    act(() => { fireEvent.click(screen.getByRole("button", { name: "30 d" })); });
    expect(screen.getByRole("button", { name: "30 d" }).getAttribute("aria-pressed")).toBe("true");
    expect(chart.getAttribute("data-points")).toBe(len("30d"));
    act(() => { fireEvent.click(screen.getByRole("button", { name: "All" })); });
    expect(chart.getAttribute("data-points")).toBe(len("all"));
    expect(len("all")).not.toBe(len("30d"));
  });

  it("marks the ATH and shows a tooltip on keyboard focus", () => {
    renderPage();
    act(() => { fireEvent.click(screen.getByRole("button", { name: "All" })); });
    expect(screen.getByTestId("ath-marker").textContent).toContain("3,117.56");
    const chart = screen.getByTestId("volume-chart");
    act(() => { chart.focus(); });
    const tip = screen.getByTestId("chart-tooltip");
    const last = history.Coordinators.kruw!.Daily.at(-1)!;
    expect(tip.textContent).toContain("249.41");
    expect(tip.textContent).toContain(`${last.Coinjoins} CoinJoins`);
    expect(tip.textContent).toContain("Day in progress");
    expect(chart.textContent).toMatch(/\b2026\b/);
    act(() => { fireEvent.keyDown(chart, { key: "Home" }); });
    expect(screen.getByTestId("chart-tooltip").textContent).toContain(`${history.Coordinators.kruw!.Daily[0]!.Coinjoins} CoinJoins`);
  });

  it("lists the 10 largest CoinJoins with Analyze links", () => {
    renderPage();
    const list = screen.getByRole("list", { name: "Largest CoinJoins" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(10);
    const top = flow.Coinjoins.filter((c) => c.Coordinator === "kruw").sort((a, b) => b.Volume - a.Volume)[0]!;
    expect(within(items[0]!).getByRole("link").getAttribute("href")).toBe(`/#tx=${top.TxId}`);
  });

  it("renders the rounds table from sats, with blame tags and Analyze links", () => {
    renderPage();
    const table = screen.getByRole("table", { name: /Recent rounds/ });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(25);
    const first = rounds.Rounds[0]!;
    expect(rows[0]!.textContent).toContain("25.74");
    const blame = within(rows[0]!).getByRole("img", { name: "Blame round: a retry after a previous round failed" });
    expect(blame.textContent).toBe("Blame");
    expect(blame.getAttribute("title")).toBe("Blame round: a retry after a previous round failed");
    expect(blame.className).not.toMatch(/warning/);
    expect(within(rows[0]!).getByRole("link").getAttribute("href")).toBe(`/#tx=${first.TxId}`);
    expect(screen.getByText("Page 1 of 911")).toBeTruthy();
  });

  it("links only well-formed txids to the analyzer", () => {
    hooks.rounds = polled<RoundsPage>({ ...rounds, Rounds: [{ ...rounds.Rounds[0]!, TxId: "zz" }, ...rounds.Rounds.slice(1)] });
    const kruw = flow.Coinjoins.filter((c) => c.Coordinator === "kruw").sort((a, b) => b.Volume - a.Volume)[0]!;
    const badFlow: FlowMap = { ...flow, Coinjoins: flow.Coinjoins.map((c) => (c === kruw ? { ...c, TxId: "not-a-txid" } : c)) };
    render(<CoordinatorPage coordinatorKey="kruw" scene={scene} flow={badFlow} status={kruwStatus} onClose={vi.fn()} />);
    const rows = within(screen.getByRole("table", { name: /Recent rounds/ })).getAllByRole("row").slice(1);
    expect(within(rows[0]!).queryByRole("link")).toBeNull();
    expect(within(rows[1]!).getByRole("link")).toBeTruthy();
    const items = within(screen.getByRole("list", { name: "Largest CoinJoins" })).getAllByRole("listitem");
    expect(within(items[0]!).queryByRole("link")).toBeNull();
    expect(within(items[1]!).getByRole("link")).toBeTruthy();
    expect(document.querySelector('a[href="/#tx=zz"], a[href="/#tx=not-a-txid"]')).toBeNull();
  });

  it("shows an error with retry when a later rounds page fails, keeping the pagination", () => {
    renderPage();
    const failed: Polled<RoundsPage> = { data: null, error: new Error("down"), loading: false, updatedAt: null, refresh: vi.fn() };
    hooks.rounds = failed;
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Next page" })); });
    expect(screen.queryByRole("table", { name: /Recent rounds/ })).toBeNull();
    act(() => { fireEvent.click(screen.getByRole("button", { name: /Try again/ })); });
    expect(failed.refresh).toHaveBeenCalled();
    expect(screen.getByText("Page 2 of 911")).toBeTruthy();
  });

  it("paginates: Next asks useRounds for the next page, Previous is disabled on page 1", () => {
    renderPage();
    expect(hooks.roundsCalls.at(-1)).toEqual(["kruw", 1]);
    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Next page" })); });
    expect(hooks.roundsCalls.at(-1)).toEqual(["kruw", 2]);
  });

  it("lists remix partners in both directions", () => {
    renderPage();
    const into = screen.getByRole("list", { name: "Coins in from" });
    expect(within(into).getAllByRole("listitem")[0]!.textContent).toContain("OpenCoordinator");
    expect(within(into).getAllByRole("listitem")[0]!.textContent).toContain("23.71");
    const out = screen.getByRole("list", { name: "Coins out to" });
    expect(within(out).getAllByRole("listitem")[0]!.textContent).toContain("2.84");
  });

  it("is a full-screen sheet on mobile: Escape closes, the close button takes focus", () => {
    setMobile(true);
    const onClose = vi.fn();
    renderPage("kruw", onClose);
    const dialog = screen.getByRole("dialog", { name: "Kruw" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close" }));
    act(() => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the chart range and rounds page when the layout switches between inline and sheet", () => {
    renderPage();
    act(() => { fireEvent.click(screen.getByRole("button", { name: "30 d" })); });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Next page" })); });
    act(() => setMobile(true));
    const dialog = screen.getByRole("dialog", { name: "Kruw" });
    expect(within(dialog).getByRole("button", { name: "30 d" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(dialog).getByText("Page 2 of 911")).toBeTruthy();
    expect(hooks.roundsCalls.at(-1)).toEqual(["kruw", 2]);
  });

  it("restores focus and page scrolling when the sheet closes", () => {
    setMobile(true);
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const page = <CoordinatorPage coordinatorKey="kruw" scene={scene} flow={flow} status={kruwStatus} onClose={vi.fn()} />;
    const { rerender } = render(<div>{page}</div>);
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).not.toBe(opener);
    rerender(<div />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("is inline on desktop and closes with its button", () => {
    const onClose = vi.fn();
    renderPage("kruw", onClose);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Close" })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders an idle coordinator (status only, no flow) with zeros", () => {
    renderPage("swisscoordinator");
    expect(screen.getByRole("heading", { level: 3, name: "SwissCoordinator" })).toBeTruthy();
    expect(screen.getByTestId("kpi-volume").textContent).toContain("0");
    expect(screen.getByText("No CoinJoins in this period.")).toBeTruthy();
    expect(screen.getByTestId("kpi-anonset").textContent).toContain("Not analysed yet");
  });

  it("renders nothing for an unknown coordinator", () => {
    const { container } = renderPage("nope");
    expect(container.innerHTML).toBe("");
    expect(hooks.roundsCalls.every(([k]) => k === null)).toBe(true);
  });
});
