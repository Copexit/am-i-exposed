// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import statusEnv from "@/lib/observatory/__tests__/fixtures/wabisator/coordinators-status.json";
import type { CoordinatorsStatus, StatusCoordinator } from "@/lib/observatory/wabisator-types";
import type { Polled } from "@/hooks/useWabisator";

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

import { LiveBoard } from "../LiveBoard";
import { fmtClock } from "../RoundRow";

const fixture = statusEnv.result as CoordinatorsStatus;
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);

const polled = (data: CoordinatorsStatus | null, extra: Partial<Polled<CoordinatorsStatus>> = {}): Polled<CoordinatorsStatus> =>
  ({ data, error: null, loading: !data, updatedAt: data ? NOW : null, refresh: () => {}, ...extra });

/** One online coordinator with the given rounds. */
const single = (rounds: StatusCoordinator["RoundStates"]): CoordinatorsStatus => ({
  UpdatedAt: "",
  Coordinators: [{ ...fixture.Coordinators[0]!, RoundStates: rounds }],
});
const round = (r: Partial<StatusCoordinator["RoundStates"][number]>) => ({
  RoundId: "r1", IsBlameRound: false, InputCount: 10, MaxSuggestedAmount: 1000, InputRegistrationRemaining: "0d 0h 2m 0s", Phase: "InputRegistration", ...r,
});

const renderBoard = (status: Polled<CoordinatorsStatus>, onOpen = vi.fn()) =>
  render(<LiveBoard status={status} onOpenCoordinator={onOpen} skeleton={<div data-testid="skeleton" />} />);

afterEach(() => vi.useRealTimers());

describe("LiveBoard", () => {
  it("shows the skeleton until the first status arrives", () => {
    renderBoard(polled(null));
    expect(screen.getByTestId("skeleton")).toBeTruthy();
  });

  it("sorts active coordinators by 24 h volume, the inactive ones behind a toggle", () => {
    vi.useFakeTimers({ now: NOW });
    renderBoard(polled(fixture));
    const names = screen.getAllByRole("article").map((a) => within(a).getByRole("heading", { level: 3 }).textContent);
    expect(names).toEqual(["Kruw", "OpenCoordinator", "GingerWallet", "Noderunners", "Coinjoiner"]);
    expect(screen.queryByText("SwissCoordinator")).toBeNull();

    const toggle = screen.getByRole("button", { name: "Show 2 inactive" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide 2 inactive" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("SwissCoordinator")).toBeTruthy();
    expect(screen.getByText("openwasabi")).toBeTruthy();
  });

  it("translates known rule keys and keeps unknown ones raw", () => {
    vi.useFakeTimers({ now: NOW });
    renderBoard(polled(fixture));
    const kruw = screen.getAllByRole("article")[0]!;
    const rules = within(kruw).getByRole("list", { name: "Rules" });
    expect(within(rules).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Fees0% + Free remixing", "Min inputs100", "Input typesP2WPKH, Taproot", "Amounts0.00009999 BTC - 1000 BTC", "Mining fee1.003 sat/vB",
    ]);
    expect(within(kruw).getByRole("link", { name: /Website/ }).getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("ticks every countdown from one shared 1 s clock", () => {
    vi.useFakeTimers({ now: NOW });
    renderBoard(polled(fixture));
    // GingerWallet: 11m 52s; Kruw's open round: 13m 40s.
    expect(screen.getByText("11:52")).toBeTruthy();
    expect(screen.getByText("13:40")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("11:51")).toBeTruthy();
    expect(screen.getByText("13:39")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText("11:46")).toBeTruthy();
    expect(screen.getByText("Refreshed 6 s ago")).toBeTruthy();
  });

  it("shows 'closing' and never a negative number once the registration time is past", () => {
    vi.useFakeTimers({ now: NOW });
    renderBoard(polled(single([round({ InputRegistrationRemaining: "0d 0h 0m -59s" })])));
    expect(screen.getByText("closing")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/-\d+:\d\d/);
  });

  it("shows no countdown at all when the remaining time is unparseable", () => {
    vi.useFakeTimers({ now: NOW });
    renderBoard(polled(single([round({ InputRegistrationRemaining: "soon" })])));
    expect(screen.queryByText("closing")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\d+:\d\d/);
  });

  it("counts inputs against the minimum, past it too, and tags blame rounds", () => {
    vi.useFakeTimers({ now: NOW });
    renderBoard(polled(single([round({ InputCount: 273, IsBlameRound: true, Phase: "OutputRegistration" })])));
    expect(screen.getByText("273 / 100")).toBeTruthy();
    expect(screen.getByText("273 inputs, 100 needed to start")).toBeTruthy();
    expect(screen.getByText("Blame round")).toBeTruthy();
    expect(screen.getByText("Output registration")).toBeTruthy();
  });

  it("opens the coordinator page from the card action and the inactive list", () => {
    vi.useFakeTimers({ now: NOW });
    const onOpen = vi.fn();
    renderBoard(polled(fixture), onOpen);
    fireEvent.click(within(screen.getAllByRole("article")[0]!).getByRole("button", { name: /History and rounds/ }));
    expect(onOpen).toHaveBeenCalledWith("kruw");
    fireEvent.click(screen.getByRole("button", { name: "Show 2 inactive" }));
    fireEvent.click(screen.getByRole("button", { name: /SwissCoordinator/ }));
    expect(onOpen).toHaveBeenLastCalledWith("swisscoordinator");
  });

  it("says so calmly when no coordinator is active", () => {
    vi.useFakeTimers({ now: NOW });
    renderBoard(polled({ UpdatedAt: "", Coordinators: fixture.Coordinators.filter((c) => c.Status !== "Online") }));
    expect(screen.getByText(/No coordinator is running rounds right now/)).toBeTruthy();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });

  it("formats the clock", () => {
    expect([fmtClock(5), fmtClock(65), fmtClock(3725)]).toEqual(["0:05", "1:05", "1:02:05"]);
  });
});
