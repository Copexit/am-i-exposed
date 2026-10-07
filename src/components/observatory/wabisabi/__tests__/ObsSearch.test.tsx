// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import flow1d from "@/lib/observatory/__tests__/fixtures/wabisator/flow-map-1d.json";
import flow7d from "@/lib/observatory/__tests__/fixtures/wabisator/flow-map-7d.json";
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
vi.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "dark" }) }));

import { ObsSearch } from "../ObsSearch";

const status = statusEnv.result as CoordinatorsStatus;
const scene1 = buildScene(flow1d.result as unknown as FlowMap, status);
const scene7 = buildScene(flow7d.result as unknown as FlowMap, status);
const event = scene1.events.find((e) => e.analyzed)!;

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T08:00:00Z"));
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(scene = scene1, period: 1 | 7 = 1) {
  const props = { onFound: vi.fn(), onJumpTo: vi.fn(), onSwitchPeriod: vi.fn() };
  const view = render(<ObsSearch scene={scene} period={period} {...props} />);
  const search = (q: string) => {
    const input = screen.getByPlaceholderText("Search a CoinJoin txid or a date");
    fireEvent.change(input, { target: { value: q } });
    fireEvent.submit(input.closest("form")!);
  };
  const panel = () => screen.queryByTestId("obs-search-result");
  return { ...props, ...view, search, panel };
}

describe("ObsSearch", () => {
  it("found: highlights the CoinJoin and shows its card with the analyze link, with no request", () => {
    const s = setup();
    s.search(event.txid.toUpperCase());
    expect(s.onFound).toHaveBeenCalledWith(event);
    const p = s.panel()!;
    expect(p.dataset.state).toBe("found");
    expect(p.textContent).toContain("Found in the last 24 h");
    expect(p.textContent).toContain(scene1.stars.find((x) => x.key === event.star)!.name);
    expect(p.textContent).toContain("Inputs");
    expect(p.textContent).toContain("Anonset");
    expect(p.querySelector("a")?.getAttribute("href")).toBe(`/#tx=${event.txid}`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("not-found: says so and offers the analyze link, sending nothing anywhere", () => {
    const s = setup();
    const txid = "ab".repeat(32);
    s.search(txid);
    expect(s.onFound).not.toHaveBeenCalled();
    const p = s.panel()!;
    expect(p.dataset.state).toBe("not-found");
    expect(p.textContent).toContain("Not a recorded WabiSabi CoinJoin in the last 24 h.");
    expect(p.textContent).toContain("the txid was not sent anywhere");
    expect(screen.getByRole("link", { name: /Analyze in am-i\.exposed/ }).getAttribute("href")).toBe(`/#tx=${txid}`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("in-period date: moves the playhead (a whole day to its first moment in the period)", () => {
    const s = setup();
    s.search("2026-10-07 01:30");
    expect(s.onJumpTo).toHaveBeenCalledWith(Date.UTC(2026, 9, 7, 1, 30) / 1000);
    expect(s.panel()!.textContent).toContain("Replay moved to Oct 7, 2026, 01:30 AM UTC");
    s.search("2026-10-06");
    expect(s.onJumpTo).toHaveBeenLastCalledWith(scene1.since);
    expect(s.panel()!.querySelector("a")).toBeNull();
  });

  it("out-of-period: offers the period that holds it, and finishes the search once that period loads", () => {
    const s = setup();
    s.search("2026-10-02");
    expect(s.panel()!.textContent).toContain("Oct 2, 2026 is outside the last 24 h.");
    fireEvent.click(screen.getByRole("button", { name: /Show the last 7 d/ }));
    expect(s.onSwitchPeriod).toHaveBeenCalledWith(7);
    expect(s.onJumpTo).not.toHaveBeenCalled();
    s.rerender(<ObsSearch scene={scene7} period={7} onFound={s.onFound} onJumpTo={s.onJumpTo} onSwitchPeriod={s.onSwitchPeriod} />);
    expect(s.onJumpTo).toHaveBeenCalledWith(Date.UTC(2026, 9, 2) / 1000);
    expect(s.panel()!.dataset.state).toBe("in-period");
  });

  it("out-of-period: beyond 30 days, or in the future, offers no switch", () => {
    const s = setup();
    s.search("2026-08-01");
    expect(s.panel()!.textContent).toContain("more than 30 days ago");
    expect(screen.queryByRole("button", { name: /Show the last/ })).toBeNull();
    s.search("2026-12-01");
    expect(s.panel()!.textContent).toContain("is in the future");
  });

  it("invalid: an inline hint, and Escape or the close button dismiss the panel", () => {
    const s = setup();
    s.search("not a txid");
    expect(s.panel()!.dataset.state).toBe("invalid");
    expect(s.panel()!.textContent).toContain("Enter a 64-character txid");
    fireEvent.keyDown(screen.getByPlaceholderText("Search a CoinJoin txid or a date"), { key: "Escape" });
    expect(s.panel()).toBeNull();
    s.search("2026-02-30");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(s.panel()).toBeNull();
    s.search("nope");
    fireEvent.pointerDown(document.body);
    expect(s.panel()).toBeNull();
    expect(s.onFound).not.toHaveBeenCalled();
    expect(s.onJumpTo).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
