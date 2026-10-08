// @vitest-environment jsdom
import "./i18n-mock";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { p2pData, emptyData, source, index } from "./p2p-data";
import { buildMarkets, methodCounts } from "@/lib/observatory/p2p/market";
import { fmtPremium } from "@/lib/observatory/p2p/p2p-format";
import type { P2pData } from "@/hooks/useP2p";

const hooks = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/hooks/useP2p", () => ({
  useP2p: () => hooks.data,
  useP2pHistory: () => ({ robosats: [], perCoordinator: {}, mostro: [], coordinators: 0, loading: true }),
}));
vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => ({ network: "mainnet", isUmbrel: false, routeReady: true }) }));
vi.mock("@/hooks/useChainTip", () => ({ useChainTip: () => null }));
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/useObservatory", () => ({ useObservatory: () => ({ whirlpool: null, loading: true, error: null, lastUpdatedAt: null, refresh: () => {} }) }));
vi.mock("@/hooks/useWabisator", () => {
  const idle = () => ({ data: null, error: null, loading: true, updatedAt: null, refresh: () => {} });
  return { useFlowMap: idle, useCoordinatorsStatus: idle, useVolumeHistory: idle, useRounds: idle };
});
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

import ObservatoryPage from "@/app/observatory/page";
import { P2pHeadline } from "../P2pHeadline";
import { SourceStrip } from "../SourceStrip";
import { MarketSelector } from "../MarketSelector";
import { headline } from "@/lib/observatory/p2p/market";

beforeEach(() => {
  window.history.replaceState(null, "", "/observatory/#p2p");
  hooks.data = p2pData();
});
afterEach(cleanup);

describe("P2P tab shell", () => {
  it("#p2p renders the P2P tab with its sections; arrow keys cycle through three tabs", () => {
    render(<ObservatoryPage />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "P2P markets" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tablist").getAttribute("aria-label")).toBe("Observatory section");
    expect([...document.querySelectorAll("section[id^=p2p-]")].map((s) => s.id)).toEqual(["p2p-headline", "p2p-markets", "p2p-premiums", "p2p-venues", "p2p-volume"]);
    expect(screen.getByTestId("p2p-headline").textContent).toMatch(/^Up to [1-9][\d.,]* BTC for sale without KYC across 3 venues\./);
    act(() => { fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" }); });
    expect(window.location.hash).toBe("#wabisabi");
    act(() => { fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" }); });
    expect(window.location.hash).toBe("#p2p");
    act(() => { fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" }); });
    expect(window.location.hash).toBe("#whirlpool");
    expect(document.querySelector("#p2p-headline")).toBeNull();
  });

  it("a currency chip writes cur= and the headline follows it", () => {
    render(<ObservatoryPage />);
    const chips = screen.getByRole("list", { name: "Currency" });
    act(() => { fireEvent.click(within(chips).getByRole("button", { name: /^EUR/ })); });
    expect(window.location.hash).toBe("#p2p&cur=EUR");
    expect(screen.getByTestId("p2p-headline").textContent).toContain("Cheapest to buy in EUR");
  });

  it("all sources down with no data: calm panel with retry, tiles show dashes", () => {
    hooks.data = emptyData("down");
    render(<ObservatoryPage />);
    expect(screen.getByTestId("p2p-all-down")).toBeTruthy();
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    for (const s of (hooks.data as P2pData).sources) expect(s.refresh).toHaveBeenCalled();
    expect(screen.getByTestId("p2p-tile-offers").textContent).toContain("–");
    expect(screen.getByTestId("p2p-tile-offers").textContent).not.toMatch(/\b0\b/);
  });
});

describe("P2pHeadline", () => {
  const data = p2pData();
  it("shows non-zero BTC and the EUR premium", () => {
    const h = headline(data.markets, data.hosts, "EUR");
    render(<P2pHeadline headline={h} currency="EUR" side="buy" loading={false} />);
    const text = screen.getByTestId("p2p-headline").textContent ?? "";
    expect(text).toContain("EUR");
    const p = data.markets.get("EUR")!.bestBuy!.premium!;
    expect(text).toContain(`${fmtPremium(Math.abs(p), "en").replace(/^[+\u2212-]/, "")} ${p < 0 ? "below" : "above"} the index`);
    expect(text).not.toMatch(/[\u2212-]\d[\d.]*% (above|over)/);
    expect(text).toMatch(/^Up to [1-9]/);
  });
  it("without data shows dashes, not zeros", () => {
    render(<P2pHeadline headline={null} currency={null} side="buy" loading={false} />);
    for (const id of ["offers", "liquidity", "median", "online"]) {
      expect(screen.getByTestId(`p2p-tile-${id}`).textContent).toContain("–");
    }
  });
});

describe("SourceStrip", () => {
  it("a partial chip exposes the timed-out relay in its description", () => {
    render(<SourceStrip sources={[source("mostro", "partial", { detail: ["wss://nos.lol"], updatedAt: Date.now() }), source("hodlhodl", "down")]} />);
    const chip = screen.getByTestId("p2p-source-mostro");
    expect(chip.getAttribute("data-state")).toBe("partial");
    const desc = document.getElementById(chip.getAttribute("aria-describedby")!);
    expect(desc?.textContent).toContain("wss://nos.lol");
    expect(screen.getByTestId("p2p-source-hodlhodl").textContent).toContain("down");
  });
});

describe("MarketSelector", () => {
  const markets = buildMarkets(p2pData().offers, index);
  it("currency chip, side toggle and venue filter that never empties", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MarketSelector markets={markets} cur="USD" side="buy" venues={["robosats", "mostro", "hodlhodl"]} onChange={onChange} />);
    fireEvent.click(within(screen.getByRole("list", { name: "Currency" })).getByRole("button", { name: /^BRL/ }));
    expect(onChange).toHaveBeenLastCalledWith({ cur: "BRL" });
    fireEvent.click(screen.getByRole("button", { name: "I want to sell BTC" }));
    expect(onChange).toHaveBeenLastCalledWith({ side: "sell" });
    fireEvent.click(screen.getByRole("button", { name: "HodlHodl" }));
    expect(onChange).toHaveBeenLastCalledWith({ venue: ["robosats", "mostro"] });
    onChange.mockClear();
    rerender(<MarketSelector markets={markets} cur="USD" side="buy" venues={["mostro"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Mostro" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "RoboSats" }));
    expect(onChange).toHaveBeenLastCalledWith({ venue: ["robosats", "mostro"] });
  });
});

describe("payment-method filter", () => {
  const eurSells = p2pData().offers.filter((o) => o.currency === "EUR" && o.side === "sell");
  const top = methodCounts(eurSells)[0]!;

  it("lists the market's methods by count, searches, writes pm= and filters the list with a note", () => {
    window.history.replaceState(null, "", "/observatory/#p2p&cur=EUR");
    render(<ObservatoryPage />);
    const trigger = screen.getByTestId("p2p-pm-trigger");
    expect(trigger.textContent).toContain("Any payment method");
    act(() => { fireEvent.click(trigger); });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const panel = screen.getByRole("group", { name: "Payment method" });
    const options = within(panel).getAllByRole("button");
    expect(options[0]!.textContent).toContain(`Any payment method${eurSells.length}`);
    expect(options[1]!.textContent).toContain(String(top.count));

    act(() => { fireEvent.change(within(panel).getByRole("searchbox", { name: "Search payment methods" }), { target: { value: "zzzz" } }); });
    expect(panel.textContent).toContain("No payment method matches.");
    act(() => { fireEvent.change(within(panel).getByRole("searchbox"), { target: { value: "revo" } }); });
    act(() => { fireEvent.click(within(panel).getByRole("button", { name: /^Revolut/ })); });
    expect(window.location.hash).toBe("#p2p&cur=EUR&pm=revolut");
    expect(screen.queryByRole("group", { name: "Payment method" })).toBeNull();

    const want = eurSells.filter((o) => o.pm.includes("revolut")).length;
    expect(want).toBeGreaterThan(0);
    expect(screen.getAllByTestId("p2p-offer-row")).toHaveLength(Math.min(want, 25));
    expect(screen.getByTestId("p2p-pm-note").textContent).toContain(`accept Revolut: ${want} offers`);

    act(() => { fireEvent.click(screen.getByRole("button", { name: "Clear payment method filter" })); });
    expect(window.location.hash).toBe("#p2p&cur=EUR");
    expect(screen.queryByTestId("p2p-pm-note")).toBeNull();
  });

  it("Escape closes the panel and returns focus; an unknown pm id is ignored", () => {
    window.history.replaceState(null, "", "/observatory/#p2p&cur=EUR&pm=bogus");
    render(<ObservatoryPage />);
    expect(screen.queryByTestId("p2p-pm-note")).toBeNull();
    const trigger = screen.getByTestId("p2p-pm-trigger");
    act(() => { fireEvent.click(trigger); });
    act(() => { fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" }); });
    expect(screen.queryByRole("group", { name: "Payment method" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("clear and Show all return focus to the trigger; the status region stays mounted", () => {
    window.history.replaceState(null, "", "/observatory/#p2p&cur=EUR&pm=revolut");
    render(<ObservatoryPage />);
    const trigger = screen.getByTestId("p2p-pm-trigger");
    const status = screen.getByTestId("p2p-pm-note").parentElement!;
    expect(status.getAttribute("role")).toBe("status");
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Clear payment method filter" })); });
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByTestId("p2p-pm-note")).toBeNull();
    expect(status.isConnected).toBe(true);

    act(() => { window.history.replaceState(null, "", "/observatory/#p2p&cur=EUR&pm=revolut"); window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(status.isConnected && status.textContent).toContain("Revolut");
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Show all methods" })); });
    expect(window.location.hash).toBe("#p2p&cur=EUR");
    expect(document.activeElement).toBe(screen.getByTestId("p2p-pm-trigger"));
  });

  it("the note counts listed offers only, like its BTC and median", () => {
    window.history.replaceState(null, "", "/observatory/#p2p&cur=EUR&pm=revolut");
    render(<ObservatoryPage />);
    const listed = eurSells.filter((o) => o.pm.includes("revolut") && !o.unlisted).length;
    expect(screen.getByTestId("p2p-pm-note").textContent).toContain(`${listed} offers`);
  });

  it("tabbing out of the panel closes it", () => {
    window.history.replaceState(null, "", "/observatory/#p2p&cur=EUR");
    render(<ObservatoryPage />);
    act(() => { fireEvent.click(screen.getByTestId("p2p-pm-trigger")); });
    const search = screen.getByRole("searchbox");
    act(() => { fireEvent.blur(search, { relatedTarget: within(screen.getByRole("group", { name: "Payment method" })).getAllByRole("button")[0] }); });
    expect(screen.queryByRole("group", { name: "Payment method" })).not.toBeNull();
    act(() => { fireEvent.blur(search, { relatedTarget: screen.getByRole("button", { name: "I want to sell BTC" }) }); });
    expect(screen.queryByRole("group", { name: "Payment method" })).toBeNull();
  });

  it("a Premiums board cell clears the method filter", () => {
    window.history.replaceState(null, "", "/observatory/#p2p&cur=EUR&pm=revolut");
    render(<ObservatoryPage />);
    const cell = document.querySelector<HTMLElement>("[data-testid^=p2p-cell-]:not([disabled])")!;
    act(() => { fireEvent.click(cell); });
    expect(window.location.hash).not.toContain("pm=");
    expect(window.location.hash).toMatch(/cur=[A-Z]+&venue=/);
  });
});
