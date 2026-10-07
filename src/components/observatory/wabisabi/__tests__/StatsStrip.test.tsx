// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import flowEnv from "@/lib/observatory/__tests__/fixtures/wabisator/flow-map-1d.json";
import type { FlowMap } from "@/lib/observatory/wabisator-types";
import { fmtBtc } from "@/lib/observatory/obs-format";

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

import { StatsStrip } from "../StatsStrip";

const totals = (flowEnv.result as FlowMap).Totals;

describe("StatsStrip", () => {
  it("shows the four period totals in tabular figures", () => {
    render(<StatsStrip totals={totals} period={7} />);
    expect(screen.getByLabelText("Totals for the last 7 d")).toBeTruthy();
    expect(screen.getByTestId("obs-stat-volume").textContent).toBe("Volume862.75BTC");
    expect(screen.getByTestId("obs-stat-coinjoins").textContent).toBe("CoinJoins91");
    expect(screen.getByTestId("obs-stat-fresh").textContent).toBe("Fresh bitcoin47.08BTC");
    expect(screen.getByTestId("obs-stat-remix").textContent).toBe("Cross remix17.28BTC");
  });

  it("shows zeros for an empty period and skeletons while loading", () => {
    const { rerender, container } = render(<StatsStrip totals={{ Volume: 0, Coinjoins: 0, FreshBtc: 0, CrossRemixBtc: 0, InternalRemixBtc: 0 }} period={1} />);
    expect(screen.getByTestId("obs-stat-volume").textContent).toBe("Volume0BTC");
    expect(screen.getByTestId("obs-stat-coinjoins").textContent).toBe("CoinJoins0");
    rerender(<StatsStrip totals={null} period={1} />);
    expect(container.querySelectorAll(".animate-pulse, [class*='animate-pulse']")).toHaveLength(4);
  });

  it("formats BTC with 2 decimals from 1 BTC up and 4 below", () => {
    expect(fmtBtc(1234.567, "en")).toBe("1,234.57");
    expect(fmtBtc(0.063772, "en")).toBe("0.0638");
    expect(fmtBtc(1, "de")).toBe("1,00");
    expect(fmtBtc(0, "en")).toBe("0");
  });
});
