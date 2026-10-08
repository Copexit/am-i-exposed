// @vitest-environment jsdom
import "./i18n-mock";
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { p2pData, NOW } from "./p2p-data";
import { signedSample } from "@/lib/observatory/p2p/__tests__/fixtures";
import { tag } from "@/lib/observatory/p2p/nostr-verify";
import { fmtPremium } from "@/lib/observatory/p2p/p2p-format";
import { depthClip } from "@/lib/observatory/p2p/market";
import { DepthWall } from "../DepthWall";
import { OfferList } from "../OfferList";

vi.mock("@visx/responsive", () => ({
  ParentSize: ({ children }: { children: (s: { width: number; height: number }) => React.ReactNode }) => <>{children({ width: 800, height: 320 })}</>,
}));

let reduced = false;
const setMedia = (opts: { wide: boolean }) => {
  window.matchMedia = ((q: string) => ({
    matches: q.includes("reduced-motion") ? reduced : q.includes("min-width: 640px") ? opts.wide : false,
    media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

afterEach(() => { cleanup(); reduced = false; });

const data = p2pData();
const usd = data.markets.get("USD")!;
const eur = data.markets.get("EUR")!;
const wall = (over: Partial<React.ComponentProps<typeof DepthWall>> = {}) => (
  <DepthWall market={usd} side="buy" view="map" hosts={data.hosts} nearest={["EUR", "BRL"]} onView={vi.fn()} onPickCurrency={vi.fn()} {...over} />
);

describe("DepthWall", () => {
  it("one focusable marker per priced offer in the clipped window; focus shows the offer", () => {
    setMedia({ wide: true });
    render(wall());
    const all = [...usd.depth.sell, ...usd.depth.buy];
    const keep = new Set(depthClip(all).points);
    const sellsKept = usd.depth.sell.filter((p) => keep.has(p));
    const focusable = screen.getAllByTestId("p2p-wall-marker").filter((m) => m.getAttribute("tabindex") === "0");
    expect(focusable).toHaveLength(sellsKept.length);
    fireEvent.focus(focusable[0]!);
    const card = screen.getByTestId("p2p-wall-card");
    expect(card.textContent).toContain(fmtPremium(sellsKept[0]!.premium, "en"));
  });

  it("animates the draw-in, except under reduced motion", () => {
    setMedia({ wide: true });
    const { unmount } = render(wall());
    expect(document.querySelector("svg[data-animated]")?.getAttribute("data-animated")).toBe("true");
    unmount();
    reduced = true;
    setMedia({ wide: true });
    render(wall());
    expect(document.querySelector("svg[data-animated]")?.getAttribute("data-animated")).toBe("false");
  });

  it("table view lists the steps; the toggle reports the view", () => {
    setMedia({ wide: true });
    const onView = vi.fn();
    render(wall({ view: "table", onView }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(usd.depth.sell.length + 1);
    fireEvent.click(screen.getByRole("button", { name: "Chart" }));
    expect(onView).toHaveBeenCalledWith("map");
  });

  it("an empty side offers the busiest markets instead", () => {
    setMedia({ wide: true });
    const onPick = vi.fn();
    const emptySide = { ...usd, offers: usd.offers.filter((o) => o.side === "buy") };
    render(wall({ market: emptySide, onPickCurrency: onPick }));
    expect(screen.getByTestId("p2p-empty").textContent).toContain("No KYC-free offers to buy in USD right now.");
    fireEvent.click(screen.getByRole("button", { name: "BRL" }));
    expect(onPick).toHaveBeenCalledWith("BRL");
  });

  it("on phones a tap opens the offer as a sheet", () => {
    setMedia({ wide: false });
    render(wall());
    fireEvent.click(screen.getAllByTestId("p2p-wall-marker").find((m) => m.getAttribute("tabindex") === "0")!);
    expect(screen.getByTestId("p2p-wall-sheet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("p2p-wall-sheet")).toBeNull();
  });
});

describe("OfferList", () => {
  const rows = () => screen.getAllByTestId("p2p-offer-row");
  const premiums = () => rows().map((r) => r.querySelector("td:nth-child(3)")?.textContent ?? "");

  it("lists the visitor's side best first; show all expands", () => {
    render(<OfferList market={usd} side="buy" hosts={data.hosts} nowSec={NOW} />);
    const sells = usd.offers.filter((o) => o.side === "sell");
    expect(rows()).toHaveLength(Math.min(25, sells.length));
    expect(rows().every((r) => r.getAttribute("data-side") === "sell")).toBe(true);
    expect(premiums()[0]).toBe(fmtPremium(usd.bestBuy!.premium!, "en"));
    if (sells.length > 25) {
      fireEvent.click(screen.getByRole("button", { name: `Show all ${sells.length}` }));
      expect(rows()).toHaveLength(sells.length);
    }
  });

  it("selling lists buy offers, highest premium first", () => {
    render(<OfferList market={eur} side="sell" hosts={data.hosts} nowSec={NOW} />);
    expect(rows().every((r) => r.getAttribute("data-side") === "buy")).toBe(true);
    expect(premiums()[0]).toBe(fmtPremium(eur.bestSell!.premium!, "en"));
  });

  it("links: Mostro has none, RoboSats says Tor, HodlHodl opens hodlhodl.com", () => {
    render(<OfferList market={eur} side="buy" hosts={data.hosts} nowSec={NOW} />);
    fireEvent.click(screen.queryByRole("button", { name: /Show all/ }) ?? document.body);
    const byVenue = (v: string) => rows().filter((r) => r.getAttribute("data-venue") === v);
    for (const r of byVenue("mostro")) {
      expect(r.querySelector("a")).toBeNull();
      expect(r.textContent).toContain("Open in any Mostro client");
    }
    const robo = byVenue("robosats").find((r) => r.querySelector("a"));
    if (robo) expect(robo.querySelector("a")!.textContent).toContain("Tor");
    const hodl = byVenue("hodlhodl")[0];
    if (hodl) expect(hodl.querySelector("a")!.getAttribute("href")).toMatch(/^https:\/\/hodlhodl\.com\/offers\//);
    expect(byVenue("robosats").length + byVenue("mostro").length + byVenue("hodlhodl").length).toBeGreaterThan(0);
  });

  it("never renders trader identities", () => {
    const nicks = signedSample.events.flatMap((e) => tag(e, "name")?.slice(0, 1) ?? []).filter((n) => n.length > 3);
    expect(nicks.length).toBeGreaterThan(0);
    for (const m of [eur, usd]) {
      for (const side of ["buy", "sell"] as const) {
        const { unmount } = render(<OfferList market={m} side={side} hosts={data.hosts} nowSec={NOW} />);
        fireEvent.click(screen.queryByRole("button", { name: /Show all/ }) ?? document.body);
        const text = document.body.textContent ?? "";
        for (const bad of ["Robot", "trader-", "@user", "[number]", "[link]", ...nicks]) expect(text, bad).not.toContain(bad);
        unmount();
      }
    }
  }, 30_000);
});
