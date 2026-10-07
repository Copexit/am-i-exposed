// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import flowEnv from "@/lib/observatory/__tests__/fixtures/wabisator/flow-map-1d.json";
import statusEnv from "@/lib/observatory/__tests__/fixtures/wabisator/coordinators-status.json";
import { buildScene } from "@/lib/observatory/sky-model";
import type { CoordinatorsStatus, FlowMap } from "@/lib/observatory/wabisator-types";

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

import { TableView } from "../TableView";

const scene = buildScene(flowEnv.result as FlowMap, statusEnv.result as CoordinatorsStatus);

describe("TableView", () => {
  it("lists every coordinator by period volume with its flow figures", () => {
    render(<TableView scene={scene} />);
    const table = screen.getByRole("table", { name: /Coordinators/ });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(7);
    const kruw = within(rows[0]!).getAllByRole("cell").map((c) => c.textContent);
    expect(within(rows[0]!).getByRole("rowheader").textContent).toContain("Kruw");
    // Status, Volume, CoinJoins, Fresh, Remix in, Remix out, Internal remix
    expect(kruw).toEqual(["Online", "853.68", "57", "46.85", "17.22", "0.0638", "774.33"]);
    // An offline coordinator with no activity in the period is listed with zeros.
    const swiss = rows.find((r) => r.textContent?.includes("SwissCoordinator"))!;
    expect(within(swiss).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Offline", "0", "0", "0", "0", "0", "0"]);
  });

  it("lists the remix flows between coordinators by BTC (internal remix is the other table's column)", () => {
    render(<TableView scene={scene} />);
    const table = screen.getByRole("table", { name: /Remix flows between coordinators/ });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect([...rows[0]!.querySelectorAll("th, td")].map((c) => c.textContent)).toEqual(["OpenCoordinator", "Kruw", "17.22", "287"]);
    for (const r of rows) {
      const [from, to] = [...r.querySelectorAll("th, td")].map((c) => c.textContent);
      expect(from).not.toBe(to);
    }
  });

  it("says so when the period has no remix flows", () => {
    render(<TableView scene={{ ...scene, flows: [] }} />);
    expect(screen.getByText("No remix flows in this period.")).toBeTruthy();
  });
});
