// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import flowEnv from "@/lib/observatory/__tests__/fixtures/wabisator/flow-map-1d.json";
import { buildScene } from "@/lib/observatory/sky-model";
import type { FlowMap } from "@/lib/observatory/wabisator-types";

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

import { Timeline } from "../Timeline";
import { Ticker } from "../Ticker";

const scene = buildScene(flowEnv.result as unknown as FlowMap, null);
afterEach(cleanup);

const mount = (props: Partial<React.ComponentProps<typeof Timeline>> = {}) => {
  const cb = { onScrub: vi.fn(), onTogglePlay: vi.fn(), onPeriod: vi.fn() };
  render(<Timeline scene={scene} period={1} progress={0.5} playing live={false} {...cb} {...props} />);
  return cb;
};

describe("Timeline", () => {
  it("scrubs by pointer and keyboard", () => {
    const { onScrub } = mount();
    const slider = screen.getByRole("slider", { name: "Replay position" });
    expect(slider.getAttribute("aria-valuenow")).toBe("50");
    vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({ left: 100, width: 400, top: 0, height: 40, right: 500, bottom: 40, x: 100, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(slider, { clientX: 200, pointerId: 1 });
    expect(onScrub).toHaveBeenLastCalledWith(0.25);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onScrub).toHaveBeenLastCalledWith(0.51);
    fireEvent.keyDown(slider, { key: "End" });
    expect(onScrub).toHaveBeenLastCalledWith(1);
  });

  it("switches period and toggles play", () => {
    const { onPeriod, onTogglePlay } = mount();
    expect(screen.getByRole("button", { name: "24 h" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "7 d" }));
    expect(onPeriod).toHaveBeenCalledWith(7);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(onTogglePlay).toHaveBeenCalled();
  });

  it("shows the LIVE pill at progress 1, and jumps to live from the replay", () => {
    const { onScrub } = mount();
    const pill = screen.getByTestId("obs-live-pill");
    expect(pill.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pill);
    expect(onScrub).toHaveBeenCalledWith(1);
    cleanup();
    mount({ progress: 1, live: true });
    expect(screen.getByTestId("obs-live-pill").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe("Now");
  });
});

describe("Ticker", () => {
  it("lists the last 6 CoinJoins up to the clock, newest first, and offers the analysis", () => {
    const onSelect = vi.fn();
    const at = scene.events[9]!.t;
    const { rerender } = render(<Ticker scene={scene} time={at} highlightTx={null} onSelect={onSelect} tone="page" withDate={false} reduced />);
    const rows = screen.getAllByRole("button");
    expect(rows).toHaveLength(6);
    expect(rows[0]!.textContent).toContain(`${scene.events[9]!.inputs} inputs`);
    fireEvent.click(rows[0]!);
    expect(onSelect).toHaveBeenCalledWith(scene.events[9]!.txid);
    rerender(<Ticker scene={scene} time={at} highlightTx={scene.events[9]!.txid} onSelect={onSelect} tone="page" withDate={false} reduced />);
    expect(screen.getByRole("link", { name: "Analyze in am-i.exposed" }).getAttribute("href")).toBe(`/#tx=${scene.events[9]!.txid}`);
  });

  it("says so before the first CoinJoin", () => {
    render(<Ticker scene={scene} time={scene.since - 1} highlightTx={null} onSelect={() => {}} tone="sky" withDate={false} reduced />);
    expect(screen.getByText("No CoinJoins yet at this point of the replay.")).toBeTruthy();
  });
});
