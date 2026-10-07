// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
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

import { SkyMap, useSkyClock } from "../SkyMap";
import { SkyClock } from "../sky-renderer";

const flow = flowEnv.result as unknown as FlowMap;
const scene = buildScene(flow, statusEnv.result as unknown as CoordinatorsStatus);

/** A 2D context that accepts every call. */
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, p) => (p in t ? t[p] : p === "measureText" ? (s: string) => ({ width: s.length * 6 }) : p.toString().startsWith("create") ? () => ({ addColorStop: () => {} }) : () => {}),
  set: (t, p, v) => { t[p] = v; return true; },
});

function setMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
}

const raf = vi.fn(() => 1);

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return (this as HTMLElement).dataset.testid === "obs-sky" ? 900 : 0; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return (this as HTMLElement).dataset.testid === "obs-sky" ? 600 : 0; } });
  raf.mockClear();
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mount = (props: Partial<React.ComponentProps<typeof SkyMap>> = {}) => {
  const onSelectStar = vi.fn();
  const onSelectEvent = vi.fn();
  render(
    <SkyMap scene={scene} period={1} clock={new SkyClock(60, 0, 0)} highlightTx={null} onSelectStar={onSelectStar} onSelectEvent={onSelectEvent} {...props} />,
  );
  return { onSelectStar, onSelectEvent };
};

describe("SkyMap", () => {
  it("mounts a canvas with a summary label", () => {
    setMotion(false);
    mount();
    const img = screen.getByRole("img");
    expect(img.tagName).toBe("CANVAS");
    expect(img.getAttribute("aria-label")).toBe("CoinJoin map for the last 24 h: 91 CoinJoins, 862.75 BTC. Most active coordinator: Kruw.");
  });

  it("has one labelled, focusable button per star, including idle coordinators", () => {
    setMotion(false);
    mount();
    expect(screen.getByRole("button", { name: "Kruw, 853.68 BTC in the last 24 h" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /in the last 24 h$/ })).toHaveLength(scene.stars.length);
  });

  it("selects a coordinator with Enter and shows its tooltip on focus", () => {
    setMotion(false);
    const { onSelectStar } = mount();
    const kruw = screen.getByRole("button", { name: /^Kruw,/ });
    fireEvent.focus(kruw);
    expect(screen.getByRole("tooltip").textContent).toContain("Online");
    fireEvent.keyDown(kruw, { key: "Enter" });
    expect(onSelectStar).toHaveBeenCalledWith("kruw");
  });

  it("runs one animation loop with motion, none under reduced motion", () => {
    setMotion(false);
    mount();
    expect(raf).toHaveBeenCalledTimes(1);
    cleanup();
    raf.mockClear();
    setMotion(true);
    mount();
    expect(raf).not.toHaveBeenCalled();
  });

  it("notes an empty period over still stars", () => {
    setMotion(false);
    const empty = buildScene({ ...flow, Coinjoins: [], Links: [] }, null);
    render(<SkyMap scene={empty} period={7} clock={new SkyClock(90, 0, 0)} highlightTx={null} onSelectStar={() => {}} onSelectEvent={() => {}} />);
    expect(screen.getByText("No CoinJoins in this period")).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("CoinJoin map for the last 7 d: no CoinJoins.");
  });

  it("pins the highlighted CoinJoin with an analyze link and closes it", () => {
    setMotion(false);
    const ev = scene.events[0]!;
    const { onSelectEvent } = mount({ highlightTx: ev.txid });
    const card = screen.getByRole("dialog", { name: "CoinJoin details" });
    expect(card.querySelector("a")?.getAttribute("href")).toBe(`/#tx=${ev.txid}`);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSelectEvent).toHaveBeenCalledWith(null);
  });
});

describe("useSkyClock", () => {
  it("replays from 0, goes live when reduced motion is known, and restarts on a period change", () => {
    const { result, rerender } = renderHook(({ period, reduced }: { period: 1 | 7 | 30; reduced: boolean }) => useSkyClock(period, reduced), { initialProps: { period: 1, reduced: false } });
    expect(result.current.progress).toBeCloseTo(0, 2);
    expect(result.current.clock.replaySec).toBe(60);
    act(() => result.current.scrub(0.4));
    expect(result.current.progress).toBe(0.4);
    rerender({ period: 7, reduced: false });
    expect(result.current.progress).toBe(0);
    expect(result.current.clock.replaySec).toBe(90);
    rerender({ period: 7, reduced: true });
    expect(result.current.live).toBe(true);
  });
});
