// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import flowEnv from "@/lib/observatory/__tests__/fixtures/wabisator/flow-map-7d.json";
import statusEnv from "@/lib/observatory/__tests__/fixtures/wabisator/coordinators-status.json";
import type { CoordinatorsStatus, FlowMap } from "@/lib/observatory/wabisator-types";
import { buildScene } from "@/lib/observatory/sky-model";

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

import { RemixFlows } from "../RemixFlows";

afterEach(cleanup);
const scene = buildScene(flowEnv.result as unknown as FlowMap, statusEnv.result as CoordinatorsStatus);

describe("RemixFlows", () => {
  it("leads with the cross-coordinator total and its share of all remixed bitcoin", () => {
    render(<RemixFlows scene={scene} onOpenCoordinator={() => {}} />);
    const total = screen.getByTestId("obs-flows-total");
    expect(total.textContent).toContain("26.68");
    expect(total.textContent).toContain("Only 0.44% of all remixed bitcoin moved to another coordinator");
  });

  it("draws one arc per coordinator with flows, ribbons only between coordinators, internal remix as an inner band", () => {
    const { container } = render(<RemixFlows scene={scene} onOpenCoordinator={() => {}} />);
    const chord = screen.getByTestId("obs-chord");
    expect([...chord.querySelectorAll("[data-group]")].map((g) => g.getAttribute("data-group"))).toEqual(["kruw", "opencoordinator", "gingerwallet", "coinjoin_nl", "coinjoiner"]);
    const ribbons = [...chord.querySelectorAll("[data-ribbon]")].map((r) => r.getAttribute("data-ribbon"));
    expect(ribbons).toContain("opencoordinator>kruw");
    expect(ribbons.some((r) => r!.split(">")[0] === r!.split(">")[1])).toBe(false);
    expect(container.querySelector('[data-internal="kruw"]')).toBeTruthy();
    // Arcs use the page-surface colour token, never a hex.
    expect(chord.querySelector('[data-group="kruw"] path:nth-child(2)')?.getAttribute("fill")).toBe("var(--coord-kruw-fg)");
  });

  it("focusing a legend item highlights its ribbons, dims the rest and shows its figures; clicking opens its page", () => {
    const open = vi.fn();
    render(<RemixFlows scene={scene} onOpenCoordinator={open} />);
    const legend = screen.getByRole("list", { name: "Coordinators in the diagram" });
    const item = within(legend).getByRole("button", { name: /^OpenCoordinator: .* through it\. Open its page\.$/ });
    fireEvent.focus(item);
    const ribbon = (id: string) => (screen.getByTestId("obs-chord").querySelector(`[data-ribbon="${id}"]`) as SVGElement).style.opacity;
    expect(ribbon("opencoordinator>kruw")).toBe("0.85");
    expect(ribbon("gingerwallet>kruw")).toBe("0.06");
    const readout = screen.getByTestId("obs-flows-readout");
    expect(readout.textContent).toContain("OpenCoordinator");
    expect(readout.textContent).toContain("Out to others23.71 BTC777 coins");
    expect(readout.textContent).toContain("In from others2.84 BTC");
    fireEvent.blur(item);
    expect(ribbon("gingerwallet>kruw")).toBe("0.5");
    fireEvent.click(item);
    expect(open).toHaveBeenCalledWith("opencoordinator");
  });

  it("hovering and clicking an arc works the same way", () => {
    const open = vi.fn();
    render(<RemixFlows scene={scene} onOpenCoordinator={open} />);
    const arc = screen.getByTestId("obs-chord").querySelector('[data-group="gingerwallet"]')!;
    fireEvent.pointerEnter(arc);
    expect(screen.getByTestId("obs-flows-readout").textContent).toContain("Ginger");
    fireEvent.click(arc);
    expect(open).toHaveBeenCalledWith("gingerwallet");
  });

  it("narrow layout: ranked bars, between coordinators first, then internal remix", () => {
    render(<RemixFlows scene={scene} onOpenCoordinator={() => {}} />);
    const [cross, internal] = screen.getAllByTestId("obs-flow-bars");
    const order = (el: HTMLElement) => [...el.querySelectorAll("[data-flow]")].map((li) => li.getAttribute("data-flow"));
    expect(order(cross!).slice(0, 3)).toEqual(["opencoordinator>kruw", "kruw>opencoordinator", "gingerwallet>kruw"]);
    expect(order(internal!)[0]).toBe("kruw>kruw");
    const top = cross!.querySelector("[data-flow]")!;
    expect(top.textContent).toContain("23.71 BTC");
    expect(top.textContent).toContain("777 coins");
  });

  it("says so when the period has no flows", () => {
    render(<RemixFlows scene={{ ...scene, flows: [] }} onOpenCoordinator={() => {}} />);
    expect(screen.getByText("No remix flows in this period.")).toBeTruthy();
    expect(screen.queryByTestId("obs-chord")).toBeNull();
  });
});
