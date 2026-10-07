// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import summaryFixture from "@/lib/observatory/__tests__/fixtures/whirlpool-summary.json";
import chartsFixture from "@/lib/observatory/__tests__/fixtures/whirlpool-charts.json";
import txsFixture from "@/lib/observatory/__tests__/fixtures/whirlpool-txs.json";
import type {
  WhirlpoolCharts,
  WhirlpoolSummary,
  WhirlpoolTxsPage,
} from "@/lib/observatory/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      ((opts?.defaultValue as string) ?? key).replace(
        /\{\{(\w+)\}\}/g,
        (m, k: string) => (opts && k in opts ? String(opts[k]) : m),
      ),
    i18n: { language: "en" },
  }),
}));

vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => ({ isUmbrel: false }),
}));

import { Sparkline } from "../Sparkline";
import { ObservatoryHero } from "../ObservatoryHero";
import { WhirlpoolPoolCard } from "../WhirlpoolPoolCard";
import { ObservatoryAttribution } from "../ObservatoryAttribution";
import { ObservatoryErrorState } from "../ObservatoryErrorState";
import { RecentCyclesTable } from "../RecentCyclesTable";

const summary = summaryFixture as WhirlpoolSummary;
const charts = chartsFixture as WhirlpoolCharts;
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

  it("ObservatoryHero renders the 2 Whirlpool KPI tiles", () => {
    const { container } = render(
      <ObservatoryHero whirlpool={summary} whirlpoolCharts={charts} loading={false} />,
    );
    expect(container.querySelectorAll("div.rounded-xl").length).toBe(2);
    expect(container.textContent).toMatch(/Whirlpool lifetime entered/);
    expect(container.textContent).not.toMatch(/WabiSabi/);
  });

  it("ObservatoryHero renders empty placeholders when data is null and not loading", () => {
    const { container } = render(
      <ObservatoryHero
        whirlpool={null}
        whirlpoolCharts={null}
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
        loading={true}
      />,
    );
    expect(container.querySelectorAll(".animate-pulse").length).toBe(2);
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

  it("WhirlpoolPoolCard shows last CoinJoin block and blocks ago when the tip is known", () => {
    const { container, rerender } = render(
      <WhirlpoolPoolCard pool={summary.pools[0]!} charts={charts} lastCjBlock={957584} tipHeight={957590} />,
    );
    expect(container.textContent).toMatch(/957,584/);
    expect(container.textContent).toMatch(/6 blocks ago/);
    rerender(<WhirlpoolPoolCard pool={summary.pools[0]!} charts={charts} lastCjBlock={957584} tipHeight={null} />);
    expect(container.textContent).toMatch(/957,584/);
    expect(container.textContent).not.toMatch(/ago/);
    rerender(<WhirlpoolPoolCard pool={summary.pools[0]!} charts={charts} />);
    expect(container.textContent).not.toMatch(/Last CoinJoin/);
  });

  it("ObservatoryAttribution links out to whirlpoolstats.xyz and wabisator.com", () => {
    const { container } = render(
      <ObservatoryAttribution lastUpdatedAt={1_700_000_000_000} locale="en" />,
    );
    const links = container.querySelectorAll("a[href]");
    const hrefs = Array.from(links).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://whirlpoolstats.xyz");
    expect(hrefs).toContain("https://wabisator.com");
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

  it("ObservatoryErrorState links to the right source per variant, with an optional retry", () => {
    const { container: wp } = render(
      <ObservatoryErrorState source="whirlpool" staleAt={null} />,
    );
    expect(wp.querySelector('a[href="https://whirlpoolstats.xyz"]')).toBeTruthy();
    expect(wp.querySelector("button")).toBeNull();
    const onRetry = vi.fn();
    const { container: ws } = render(
      <ObservatoryErrorState source="wabisator" staleAt={null} onRetry={onRetry} />,
    );
    expect(ws.querySelector('a[href="https://wabisator.com"]')).toBeTruthy();
    ws.querySelector("button")!.click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("no rendered text contains the literal substring 'observatory.whirlpool.'", () => {
    // Catches removed-but-still-referenced i18n keys (would render as the raw key
    // string via the test mock's t() fallback).
    const { container } = render(
      <>
        <ObservatoryHero
          whirlpool={summary}
          whirlpoolCharts={charts}
          loading={false}
        />
        <WhirlpoolPoolCard pool={summary.pools[0]!} charts={charts} />
        <WhirlpoolPoolCard pool={summary.pools[1]!} charts={charts} />
      </>,
    );
    expect(container.textContent ?? "").not.toMatch(/observatory\.whirlpool\./);
  });
});
