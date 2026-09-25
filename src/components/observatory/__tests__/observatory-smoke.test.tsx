// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import summaryFixture from "@/lib/observatory/__tests__/fixtures/whirlpool-summary.json";
import chartsFixture from "@/lib/observatory/__tests__/fixtures/whirlpool-charts.json";
import dashboardFixture from "@/lib/observatory/__tests__/fixtures/liquisabi-dashboard.json";
import txsFixture from "@/lib/observatory/__tests__/fixtures/whirlpool-txs.json";
import type {
  LiquiSabiDashboard,
  WhirlpoolCharts,
  WhirlpoolSummary,
  WhirlpoolTxsPage,
} from "@/lib/observatory/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.defaultValue as string) ?? key,
    i18n: { language: "en" },
  }),
}));

vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => ({ isUmbrel: false }),
}));

import { Sparkline } from "../Sparkline";
import { ObservatoryHero } from "../ObservatoryHero";
import { WhirlpoolPoolCard } from "../WhirlpoolPoolCard";
import { WabiSabiCoordinatorCard } from "../WabiSabiCoordinatorCard";
import { ObservatoryAttribution } from "../ObservatoryAttribution";
import { ObservatoryErrorState } from "../ObservatoryErrorState";
import { RecentCyclesTable } from "../RecentCyclesTable";
import { projectCoordinators } from "@/lib/observatory/selectors";

const summary = summaryFixture as WhirlpoolSummary;
const charts = chartsFixture as WhirlpoolCharts;
const dashboard = dashboardFixture as unknown as LiquiSabiDashboard;
const txs = txsFixture as WhirlpoolTxsPage;

describe("observatory smoke tests", () => {
  it("Sparkline renders an SVG path for non-empty input", () => {
    const { container } = render(
      <Sparkline points={[{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 3 }]} />,
    );
    const path = container.querySelector("svg path");
    expect(path).toBeTruthy();
    expect(path?.getAttribute("d")).toMatch(/^M/);
  });

  it("Sparkline renders an empty placeholder for <2 points", () => {
    const { container } = render(<Sparkline points={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("ObservatoryHero renders all 4 KPI tiles", () => {
    const { container } = render(
      <ObservatoryHero
        whirlpool={summary}
        whirlpoolCharts={charts}
        liquisabi={dashboard}
        loading={false}
      />,
    );
    expect(container.querySelectorAll("div.rounded-xl").length).toBeGreaterThanOrEqual(4);
  });

  it("ObservatoryHero renders empty placeholders when data is null and not loading", () => {
    const { container } = render(
      <ObservatoryHero
        whirlpool={null}
        whirlpoolCharts={null}
        liquisabi={null}
        loading={false}
      />,
    );
    expect(container.textContent).not.toMatch(/0\.000 BTC/);
  });

  it("ObservatoryHero renders skeleton bars when loading without data", () => {
    const { container } = render(
      <ObservatoryHero
        whirlpool={null}
        whirlpoolCharts={null}
        liquisabi={null}
        loading={true}
      />,
    );
    expect(container.querySelectorAll(".animate-pulse").length).toBe(4);
  });

  it("WhirlpoolPoolCard renders the pool label, unspent capacity, and sparkline", () => {
    const { getByText, container } = render(
      <WhirlpoolPoolCard pool={summary.pools[0]!} charts={charts} />,
    );
    expect(getByText("0.025 BTC Pool")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
    // Headline = summary unspent_btc for the 0.025 pool = 13.65 BTC.
    expect(container.textContent).toMatch(/13\.65 BTC/);
  });

  it("WabiSabiCoordinatorCard renders coordinator name and fresh-input share", () => {
    const views = projectCoordinators(dashboard);
    const kruw = views.find((v) => v.name === "Kruw.io")!;
    const { getByText } = render(
      <WabiSabiCoordinatorCard coordinator={kruw} avgAnonIn={3.9} avgAnonOut={6.9} />,
    );
    expect(getByText("Kruw.io")).toBeTruthy();
    expect(getByText("99.72%")).toBeTruthy();
  });

  it("WabiSabiCoordinatorCard flags a paid coordinator", () => {
    const views = projectCoordinators(dashboard);
    const ginger = views.find((v) => v.name === "Gingerwallet")!;
    const { getByText } = render(
      <WabiSabiCoordinatorCard coordinator={ginger} avgAnonIn={null} avgAnonOut={null} />,
    );
    expect(getByText("Paid")).toBeTruthy();
  });

  it("ObservatoryAttribution renders both data-source link-outs at the new whirlpoolstats URL", () => {
    const { container } = render(
      <ObservatoryAttribution lastUpdatedAt={1_700_000_000_000} locale="en" />,
    );
    const links = container.querySelectorAll("a[href]");
    const hrefs = Array.from(links).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://whirlpoolstats.xyz");
    expect(hrefs).toContain("https://liquisabi.com");
  });

  it("RecentCyclesTable renders one same-origin scan link per cycle", () => {
    const { container } = render(<RecentCyclesTable firstPage={txs} />);
    expect(container.querySelectorAll("li").length).toBe(txs.items.length);
    const hrefs = Array.from(container.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain(`/#tx=${txs.items[0]!.txid}`);
    // Never links to the external upstream URL.
    expect(hrefs.some((h) => h?.includes("am-i.exposed"))).toBe(false);
  });

  it("RecentCyclesTable renders nothing when there is no page", () => {
    const { container } = render(<RecentCyclesTable firstPage={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("RecentCyclesTable dedups duplicate txids", () => {
    const dupe = { ...txs, items: [txs.items[0], txs.items[0]] } as WhirlpoolTxsPage;
    const { container } = render(<RecentCyclesTable firstPage={dupe} />);
    expect(container.querySelectorAll("li").length).toBe(1);
  });

  it("ObservatoryErrorState links to the right source per variant", () => {
    const { container: wp } = render(
      <ObservatoryErrorState source="whirlpool" staleAt={null} />,
    );
    expect(wp.querySelector('a[href="https://whirlpoolstats.xyz"]')).toBeTruthy();
    const { container: ls } = render(
      <ObservatoryErrorState source="liquisabi" staleAt={null} />,
    );
    expect(ls.querySelector('a[href="https://liquisabi.com"]')).toBeTruthy();
  });

  it("no rendered text contains the literal substring 'observatory.whirlpool.'", () => {
    // Catches removed-but-still-referenced i18n keys (would render as the raw key
    // string via the test mock's t() fallback).
    const { container } = render(
      <>
        <ObservatoryHero
          whirlpool={summary}
          whirlpoolCharts={charts}
          liquisabi={dashboard}
          loading={false}
        />
        <WhirlpoolPoolCard pool={summary.pools[0]!} charts={charts} />
        <WhirlpoolPoolCard pool={summary.pools[1]!} charts={charts} />
      </>,
    );
    expect(container.textContent ?? "").not.toMatch(/observatory\.whirlpool\./);
  });
});
