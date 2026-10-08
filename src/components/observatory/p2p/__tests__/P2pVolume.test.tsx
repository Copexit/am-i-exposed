// @vitest-environment jsdom
import "./i18n-mock";
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { robosatsHistory } from "@/lib/observatory/p2p/normalize-robosats";
import { mostroDaily } from "@/lib/observatory/p2p/normalize-mostro";
import { sumDaily } from "@/lib/observatory/p2p/volume";
import { templeHistorical, lakeHistorical, mostroTrades, NOW } from "@/lib/observatory/p2p/__tests__/fixtures";
import { index } from "./p2p-data";
import { P2pVolume } from "../P2pVolume";

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
afterEach(cleanup);

const per = { temple: robosatsHistory(templeHistorical), lake: robosatsHistory(lakeHistorical) };
const history = { robosats: sumDaily(Object.values(per)), perCoordinator: per, mostro: mostroDaily(mostroTrades.events, index, NOW), coordinators: 2, loading: false };

describe("P2pVolume", () => {
  it("public site: 2 of 7 coordinators with the Tor note; Mostro 7 days; HodlHodl line", () => {
    render(<P2pVolume history={history} isUmbrel={false} today="2026-10-07" />);
    expect(screen.getByTestId("p2p-volume-coverage").textContent).toContain("2 of 7 coordinators");
    expect(screen.getByTestId("p2p-volume-coverage").textContent).toContain("Tor");
    expect(screen.getByTestId("p2p-mostro-days").children).toHaveLength(7);
    expect(screen.getByText("HodlHodl publishes no volume data.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "30 d" }));
    expect(screen.getByRole("button", { name: "30 d" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("self-hosted drops the Tor note", () => {
    render(<P2pVolume history={{ ...history, coordinators: 5 }} isUmbrel today="2026-10-07" />);
    expect(screen.getByTestId("p2p-volume-coverage").textContent).toBe("5 of 7 coordinators");
  });
});
