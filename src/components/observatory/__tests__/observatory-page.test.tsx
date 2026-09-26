// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import summaryFixture from "@/lib/observatory/__tests__/fixtures/whirlpool-summary.json";
import chartsFixture from "@/lib/observatory/__tests__/fixtures/whirlpool-charts.json";
import type { WhirlpoolCharts, WhirlpoolSummary } from "@/lib/observatory/types";

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

vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => ({ network: "mainnet", isUmbrel: false }),
}));

vi.mock("@/hooks/useChainTip", () => ({ useChainTip: () => null }));

vi.mock("@/components/PageShell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const summary = summaryFixture as WhirlpoolSummary;
const charts = chartsFixture as WhirlpoolCharts;

// Upstream reorders pools: 0.25 first, 0.025 second.
vi.mock("@/hooks/useObservatory", () => ({
  useObservatory: () => ({
    whirlpool: {
      summary: { ...summary, pools: [...summary.pools].reverse() },
      charts,
      txs: null,
    },
    liquisabi: null,
    loading: false,
    error: null,
    lastUpdatedAt: null,
  }),
}));

import ObservatoryPage from "@/app/observatory/page";

// jsdom has no ResizeObserver (used by the chart's parent-size hook)
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

describe("ObservatoryPage whirlpool trend footer", () => {
  it("reports the 0.025 pool values regardless of upstream pool order", () => {
    render(<ObservatoryPage />);
    // 0.025_BTC_Pool capacity series runs 0.05 -> 13.65 in the fixture
    expect(screen.getByText(/0\.025 pool: start 0\.05 BTC · end 13\.65 BTC/)).toBeTruthy();
  });
});
