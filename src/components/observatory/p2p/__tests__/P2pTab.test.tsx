// @vitest-environment jsdom
import "./i18n-mock";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { p2pData, emptyData, source, index } from "./p2p-data";
import { amountMatch, buildMarkets, methodCounts } from "@/lib/observatory/p2p/market";
import { fmtBtcAmount } from "../AmountFilter";
import { fmtPremium } from "@/lib/observatory/p2p/p2p-format";
import type { P2pData } from "@/hooks/useP2p";

const hooks = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("next/navigation", () => ({ usePathname: () => window.location.pathname }));

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
  window.history.replaceState(null, "", "/observatory/p2p/");
  hooks.data = p2pData();
});
afterEach(cleanup);

describe("P2P tab shell", () => {
  it("/observatory/p2p/ renders the P2P tab with its sections; tabs link to their routes and arrow keys cycle focus", () => {
    render(<ObservatoryPage />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "P2P markets" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tablist").getAttribute("aria-label")).toBe("Observatory section");
    expect([...document.querySelectorAll("section[id^=p2p-]")].map((s) => s.id)).toEqual(["p2p-headline", "p2p-markets", "p2p-premiums", "p2p-venues", "p2p-volume"]);
    expect(screen.getByTestId("p2p-headline").textContent).toMatch(/^Up to [1-9][\d.,]* BTC for sale without KYC across 3 venues\./);
    // next/link drops the trailing slash outside the build (trailingSlash is a build setting).
    expect(tabs.map((t) => t.getAttribute("href")?.replace(/\/$/, ""))).toEqual(["/observatory/wabisabi", "/observatory/whirlpool", "/observatory/p2p"]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("KYC-free bitcoin P2P offers: RoboSats, Mostro, HodlHodl");
    act(() => { fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" }); });
    expect(document.activeElement?.id).toBe("observatory-tab-wabisabi");
    act(() => { fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" }); });
    expect(document.activeElement?.id).toBe("observatory-tab-p2p");
    act(() => { fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" }); });
    expect(document.activeElement?.id).toBe("observatory-tab-whirlpool");
  });

  it("a currency chip writes cur= and the headline follows it", () => {
    render(<ObservatoryPage />);
    const chips = screen.getByRole("list", { name: "Currency" });
    act(() => { fireEvent.click(within(chips).getByRole("button", { name: /^EUR/ })); });
    expect(window.location.hash).toBe("#cur=EUR");
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
    window.history.replaceState(null, "", "/observatory/p2p/#cur=EUR");
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
    expect(window.location.hash).toBe("#cur=EUR&pm=revolut");
    expect(screen.queryByRole("group", { name: "Payment method" })).toBeNull();

    const want = eurSells.filter((o) => o.pm.includes("revolut")).length;
    expect(want).toBeGreaterThan(0);
    expect(screen.getAllByTestId("p2p-offer-row")).toHaveLength(Math.min(want, 25));
    expect(screen.getByTestId("p2p-pm-note").textContent).toContain(`accept Revolut: ${want} offers`);

    act(() => { fireEvent.click(screen.getByRole("button", { name: "Clear payment method filter" })); });
    expect(window.location.hash).toBe("#cur=EUR");
    expect(screen.queryByTestId("p2p-pm-note")).toBeNull();
  });

  it("Escape closes the panel and returns focus; an unknown pm id is ignored", () => {
    window.history.replaceState(null, "", "/observatory/p2p/#cur=EUR&pm=bogus");
    render(<ObservatoryPage />);
    expect(screen.queryByTestId("p2p-pm-note")).toBeNull();
    const trigger = screen.getByTestId("p2p-pm-trigger");
    act(() => { fireEvent.click(trigger); });
    act(() => { fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" }); });
    expect(screen.queryByRole("group", { name: "Payment method" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("clear and Show all return focus to the trigger; the status region stays mounted", () => {
    window.history.replaceState(null, "", "/observatory/p2p/#cur=EUR&pm=revolut");
    render(<ObservatoryPage />);
    const trigger = screen.getByTestId("p2p-pm-trigger");
    const status = screen.getByTestId("p2p-pm-note").parentElement!;
    expect(status.getAttribute("role")).toBe("status");
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Clear payment method filter" })); });
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByTestId("p2p-pm-note")).toBeNull();
    expect(status.isConnected).toBe(true);

    act(() => { window.history.replaceState(null, "", "/observatory/p2p/#cur=EUR&pm=revolut"); window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(status.isConnected && status.textContent).toContain("Revolut");
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Show all methods" })); });
    expect(window.location.hash).toBe("#cur=EUR");
    expect(document.activeElement).toBe(screen.getByTestId("p2p-pm-trigger"));
  });

  it("the note counts listed offers only, like its BTC and median", () => {
    window.history.replaceState(null, "", "/observatory/p2p/#cur=EUR&pm=revolut");
    render(<ObservatoryPage />);
    const listed = eurSells.filter((o) => o.pm.includes("revolut") && !o.unlisted).length;
    expect(screen.getByTestId("p2p-pm-note").textContent).toContain(`${listed} offers`);
  });

  it("tabbing out of the panel closes it", () => {
    window.history.replaceState(null, "", "/observatory/p2p/#cur=EUR");
    render(<ObservatoryPage />);
    act(() => { fireEvent.click(screen.getByTestId("p2p-pm-trigger")); });
    const search = screen.getByRole("searchbox");
    act(() => { fireEvent.blur(search, { relatedTarget: within(screen.getByRole("group", { name: "Payment method" })).getAllByRole("button")[0] }); });
    expect(screen.queryByRole("group", { name: "Payment method" })).not.toBeNull();
    act(() => { fireEvent.blur(search, { relatedTarget: screen.getByRole("button", { name: "I want to sell BTC" }) }); });
    expect(screen.queryByRole("group", { name: "Payment method" })).toBeNull();
  });

  it("a Premiums board cell clears the method filter", () => {
    window.history.replaceState(null, "", "/observatory/p2p/#cur=EUR&pm=revolut");
    render(<ObservatoryPage />);
    const cell = document.querySelector<HTMLElement>("[data-testid^=p2p-cell-]:not([disabled])")!;
    act(() => { fireEvent.click(cell); });
    expect(window.location.hash).not.toContain("pm=");
    expect(window.location.hash).toMatch(/cur=[A-Z]+&venue=/);
  });
});

describe("amount filter", () => {
  const all = p2pData().offers;
  const eurSells = all.filter((o) => o.currency === "EUR" && o.side === "sell");
  const idx = index.prices.EUR!;
  const takes = (o: (typeof all)[number], a: number) => amountMatch(o, a) !== null;
  const type = (v: string) => {
    act(() => { fireEvent.change(screen.getByTestId("p2p-amount"), { target: { value: v } }); });
    act(() => { vi.advanceTimersByTime(450); });
  };
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("typing writes amt= after a pause and narrows the list, note and cheapest line", () => {
    window.history.replaceState(null, "", "/observatory/p2p/#cur=EUR");
    render(<ObservatoryPage />);
    const input = screen.getByRole("textbox", { name: "Amount in EUR" });
    expect(input.getAttribute("inputmode")).toBe("decimal");
    act(() => { fireEvent.change(input, { target: { value: "250" } }); });
    expect(window.location.hash).toBe("#cur=EUR");
    act(() => { vi.advanceTimersByTime(450); });
    expect(window.location.hash).toBe("#cur=EUR&amt=250&amtu=fiat");
    // The clear button sits beside the input, not in its name.
    expect(screen.getByRole("textbox", { name: "Amount in EUR" })).toBe(input);
    expect(input.getAttribute("aria-label")).toBe("Amount in EUR");
    expect(screen.getByTestId("p2p-amount-converted").textContent).toContain(`≈ ${fmtBtcAmount(250 / idx, "en")} BTC`);

    const match = eurSells.filter((o) => takes(o, 250));
    const listed = match.filter((o) => !o.unlisted);
    expect(match.length).toBeGreaterThan(0);
    expect(match.length).toBeLessThan(eurSells.length);
    expect(screen.getAllByTestId("p2p-offer-row")).toHaveLength(Math.min(match.length, 25));
    expect(screen.getByTestId("p2p-pm-note").textContent).toContain(`Offers that accept €250: ${listed.length} offers`);
    const best = Math.min(...listed.flatMap((o) => (o.premium === null ? [] : [o.premium])));
    expect(screen.getByTestId("p2p-amount-best").textContent).toMatch(new RegExp(`^Cheapest for €250: .+, ${fmtPremium(best, "en").replace(/[+.]/g, "\\$&")}\\.$`));

    act(() => { fireEvent.click(screen.getByRole("button", { name: "Any amount" })); });
    expect(window.location.hash).toBe("#cur=EUR");
    expect((input as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(input);
  }, 30_000);

  it("composes with the method filter and the sell side", () => {
    const eurBuys = all.filter((o) => o.currency === "EUR" && o.side === "buy" && !o.unlisted);
    const pm = methodCounts(eurBuys.filter((o) => takes(o, 500)))[0]!.id;
    window.history.replaceState(null, "", `/observatory/p2p/#cur=EUR&side=sell&pm=${pm}&amt=500&amtu=fiat`);
    render(<ObservatoryPage />);
    const want = eurBuys.filter((o) => takes(o, 500) && o.pm.includes(pm)).length;
    expect(screen.getByTestId("p2p-pm-note").textContent).toMatch(new RegExp(`accept €500 by .+: ${want} offers?`));
    expect(screen.getByTestId("p2p-amount-best").textContent).toMatch(/^Best price to sell €500 by /);
    expect((screen.getByTestId("p2p-amount") as HTMLInputElement).value).toBe("500");
  }, 30_000);

  it("the BTC unit converts at the index and survives a currency switch; a fiat amount does not", () => {
    window.history.replaceState(null, "", "/observatory/p2p/#cur=EUR&amt=250&amtu=fiat");
    render(<ObservatoryPage />);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "BTC" })); });
    const btc = Math.round((250 / idx) * 1e8) / 1e8;
    expect(window.location.hash).toBe(`#cur=EUR&amt=${btc}&amtu=btc`);
    expect(screen.getByRole("textbox", { name: "Amount in BTC" })).toBeTruthy();
    expect(screen.getByTestId("p2p-amount-converted").textContent).toMatch(/≈ €2(49|50)/);
    const chips = screen.getByRole("list", { name: "Currency" });
    act(() => { fireEvent.click(within(chips).getByRole("button", { name: /^USD/ })); });
    expect(window.location.hash).toBe(`#cur=USD&amt=${btc}&amtu=btc`);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "USD" })); });
    expect(window.location.hash).toMatch(/^#cur=USD&amt=\d+(\.\d+)?&amtu=fiat$/);
    act(() => { fireEvent.click(within(chips).getByRole("button", { name: /^EUR/ })); });
    expect(window.location.hash).toBe("#cur=EUR");
  }, 30_000);

  it("locale grouping, invalid text and the clear button", () => {
    window.history.replaceState(null, "", "/observatory/p2p/#cur=EUR");
    render(<ObservatoryPage />);
    type("1,234.5");
    expect(window.location.hash).toBe("#cur=EUR&amt=1234.5&amtu=fiat");
    type("1.234,5");
    expect(window.location.hash).toBe("#cur=EUR&amt=1234.5&amtu=fiat");
    type("abc");
    expect(screen.getByTestId("p2p-amount").getAttribute("aria-invalid")).toBe("true");
    expect(window.location.hash).toBe("#cur=EUR");
    type("0,001");
    expect(screen.getByTestId("p2p-amount-converted").textContent).toContain("Enter an amount between 0.01 and 1,000,000,000,000.");
    expect(window.location.hash).toBe("#cur=EUR");
    type("2000000000000");
    expect(screen.getByTestId("p2p-amount-converted").textContent).toContain("between 0.01 and");
    type("EUR 250");
    expect(window.location.hash).toBe("#cur=EUR&amt=250&amtu=fiat");
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Clear amount filter" })); });
    expect(window.location.hash).toBe("#cur=EUR");
    expect(document.activeElement).toBe(screen.getByTestId("p2p-amount"));
  }, 30_000);

  it("a currency switch while typing drops the pending fiat amount", () => {
    window.history.replaceState(null, "", "/observatory/p2p/#cur=EUR");
    render(<ObservatoryPage />);
    act(() => { fireEvent.change(screen.getByTestId("p2p-amount"), { target: { value: "250" } }); });
    act(() => { fireEvent.click(within(screen.getByRole("list", { name: "Currency" })).getByRole("button", { name: /^USD\d/ })); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(window.location.hash).toBe("#cur=USD");
    expect((screen.getByRole("textbox", { name: "Amount in USD" }) as HTMLInputElement).value).toBe("");
  }, 30_000);

  it("BTC is aria-disabled with a reachable reason when the currency has no index", () => {
    const { EUR: _drop, ...prices } = index.prices;
    hooks.data = p2pData({ index: { ...index, prices } });
    window.history.replaceState(null, "", "/observatory/p2p/#cur=EUR");
    render(<ObservatoryPage />);
    const btc = within(screen.getByRole("group", { name: "Amount unit" })).getByRole("button", { name: "BTC" });
    expect(btc.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(btc.getAttribute("aria-describedby")!)!.textContent).toContain("No index price for EUR");
    act(() => { fireEvent.click(btc); });
    expect(window.location.hash).not.toContain("amtu=btc");
  }, 30_000);
});
