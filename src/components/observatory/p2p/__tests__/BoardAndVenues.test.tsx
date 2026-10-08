// @vitest-environment jsdom
import "./i18n-mock";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { p2pData } from "./p2p-data";
import { premiumBoard } from "@/lib/observatory/p2p/market";
import { PremiumBoard } from "../PremiumBoard";
import { VenueSection } from "../VenueSection";

afterEach(cleanup);
const data = p2pData();

describe("PremiumBoard", () => {
  const rows = premiumBoard(data.markets, "buy");
  it("a cell click selects that market and venue; the best cell per row is marked", () => {
    const onSelect = vi.fn();
    render(<PremiumBoard rows={rows} side="buy" onSelect={onSelect} />);
    const eur = rows.find((r) => r.currency === "EUR")!;
    expect(eur.cells.mostro.median).not.toBeNull();
    fireEvent.click(screen.getByTestId("p2p-cell-EUR-mostro"));
    expect(onSelect).toHaveBeenCalledWith("EUR", "mostro");
    for (const r of rows) {
      const priced = (["robosats", "mostro", "hodlhodl"] as const).filter((v) => r.cells[v].median !== null);
      if (priced.length < 2) {
        expect(screen.getByTestId(`p2p-cell-${r.currency}-${priced[0]}`).getAttribute("data-best")).toBeNull();
        continue;
      }
      const best = priced.reduce((a, b) => (r.cells[b].median! < r.cells[a].median! ? b : a));
      expect(screen.getByTestId(`p2p-cell-${r.currency}-${best}`).getAttribute("data-best")).toBe("true");
    }
  });
});

describe("VenueSection", () => {
  it("public site: bazaar is Tor only; temple shows fees and lifetime volume", () => {
    render(<VenueSection hosts={data.hosts} isUmbrel={false} highlight={null} />);
    const bazaar = screen.getByTestId("p2p-coord-bazaar");
    expect(bazaar.textContent).toContain("Tor only");
    expect(document.body.textContent).toContain("full stats on a self-hosted node");
    expect(bazaar.textContent).not.toContain("Maker / taker fee");
    const temple = screen.getByTestId("p2p-coord-temple");
    expect(temple.textContent).toContain("0.025%");
    expect(temple.textContent).toContain("192.30 BTC");
    expect(screen.getByTestId("p2p-hodlhodl").textContent).toContain("HodlHodl");
  });

  it("Mostro inactive instances sit behind a toggle", () => {
    render(<VenueSection hosts={data.hosts} isUmbrel={false} highlight={null} />);
    const mostro = data.hosts.filter((h) => h.venue === "mostro");
    const active = mostro.filter((h) => h.status === "up").length;
    expect(within(screen.getByTestId("p2p-mostro")).getAllByTestId("p2p-mostro-row")).toHaveLength(active);
    fireEvent.click(screen.getByRole("button", { name: `Show ${mostro.length - active} inactive` }));
    expect(within(screen.getByTestId("p2p-mostro")).getAllByTestId("p2p-mostro-row")).toHaveLength(mostro.length);
  });

  it("coordinator=temple highlights the temple card", () => {
    render(<VenueSection hosts={data.hosts} isUmbrel={false} highlight="temple" />);
    expect(screen.getByTestId("p2p-coord-temple").getAttribute("data-highlighted")).toBe("true");
    expect(screen.getByTestId("p2p-coord-lake").getAttribute("data-highlighted")).toBeNull();
  });
});
