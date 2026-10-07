// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import flowEnv from "@/lib/observatory/__tests__/fixtures/wabisator/flow-map-7d.json";
import statusEnv from "@/lib/observatory/__tests__/fixtures/wabisator/coordinators-status.json";
import type { CoordinatorsStatus, FlowMap } from "@/lib/observatory/wabisator-types";
import { buildScene } from "@/lib/observatory/sky-model";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      let s = (opts?.defaultValue as string) ?? key;
      for (const [k, v] of Object.entries(opts ?? {})) s = s.replaceAll(`{{${k}}}`, String(v));
      return s;
    },
    i18n: { language: "en" },
  }),
}));

import { RemixFlows } from "../RemixFlows";

afterEach(cleanup);
const scene = buildScene(flowEnv.result as unknown as FlowMap, statusEnv.result as CoordinatorsStatus);

describe("RemixFlows", () => {
  const rows = () => [...document.querySelectorAll<HTMLButtonElement>("[data-flow]")];
  const opacity = (id: string) => document.querySelector<HTMLElement>(`[data-flow="${id}"]`)!.style.opacity;

  it("leads with the cross-coordinator total and the crossed vs internal share bar", () => {
    render(<RemixFlows scene={scene} onOpenCoordinator={() => {}} />);
    const total = screen.getByTestId("obs-flows-total");
    expect(total.textContent).toContain("26.68");
    expect(total.textContent).toContain("Only 0.44% of all remixed bitcoin moved to another coordinator");
    const bar = screen.getByTestId("obs-flows-share");
    expect((bar.querySelector('[data-part="cross"]') as HTMLElement).style.width).toBe(`${(100 * scene.totals.CrossRemixBtc) / (scene.totals.CrossRemixBtc + scene.totals.InternalRemixBtc)}%`);
    expect(bar.textContent).toContain("Between coordinators0.44%");
    expect(bar.textContent).toContain("Internal remix99.6%");
  });

  it("ranks flows in two lists: between coordinators, then internal remix", () => {
    render(<RemixFlows scene={scene} onOpenCoordinator={() => {}} />);
    const [cross, internal] = screen.getAllByTestId("obs-flow-bars");
    const order = (el: HTMLElement) => [...el.querySelectorAll("[data-flow]")].map((b) => b.getAttribute("data-flow"));
    expect(order(cross!).slice(0, 3)).toEqual(["opencoordinator>kruw", "kruw>opencoordinator", "gingerwallet>kruw"]);
    expect(order(internal!)[0]).toBe("kruw>kruw");
    const top = cross!.querySelector("[data-flow]")!;
    expect(top.textContent).toContain("23.71 BTC");
    expect(top.textContent).toContain("777 coins");
    // Marks use the page-surface colour tokens, never a hex.
    expect(top.innerHTML).toContain("var(--coord-opencoordinator-fg)");
    expect(top.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it("rows are labelled buttons: focus lights rows sharing a coordinator and dims the rest; click opens the From coordinator", () => {
    const open = vi.fn();
    render(<RemixFlows scene={scene} onOpenCoordinator={open} />);
    const row = screen.getByRole("button", { name: /^OpenCoordinator to Kruw: 23\.71 BTC, 777 coins\. Open OpenCoordinator\.$/ });
    expect(rows().every((b) => b.tagName === "BUTTON" && b.className.includes("min-h-10"))).toBe(true);
    fireEvent.focus(row);
    expect(opacity("opencoordinator>kruw")).toBe("1");
    expect(opacity("gingerwallet>kruw")).toBe("1"); // shares Kruw
    expect(opacity("opencoordinator>opencoordinator")).toBe("1");
    expect(opacity("gingerwallet>gingerwallet")).toBe("0.35");
    fireEvent.blur(row);
    expect(opacity("gingerwallet>gingerwallet")).toBe("1");
    fireEvent.click(row);
    expect(open).toHaveBeenCalledWith("opencoordinator");
  });

  it("hover highlights the same way, and internal rows open their coordinator", () => {
    const open = vi.fn();
    render(<RemixFlows scene={scene} onOpenCoordinator={open} />);
    const row = screen.getByRole("button", { name: /^GingerWallet, internal remix: / });
    fireEvent.pointerEnter(row);
    expect(opacity("gingerwallet>kruw")).toBe("1");
    expect(opacity("opencoordinator>opencoordinator")).toBe("0.35");
    fireEvent.pointerLeave(row);
    expect(opacity("opencoordinator>opencoordinator")).toBe("1");
    fireEvent.click(row);
    expect(open).toHaveBeenCalledWith("gingerwallet");
  });

  it("says so when the period has no flows", () => {
    render(<RemixFlows scene={{ ...scene, flows: [] }} onOpenCoordinator={() => {}} />);
    expect(screen.getByText("No remix flows in this period.")).toBeTruthy();
    expect(screen.queryByTestId("obs-flow-bars")).toBeNull();
  });
});
