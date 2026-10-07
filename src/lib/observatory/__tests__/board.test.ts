import { describe, it, expect } from "vitest";
import statusEnv from "./fixtures/wabisator/coordinators-status.json";
import { buildBoard, countdownLabel, parseRemaining, PHASES } from "../board";
import type { CoordinatorsStatus } from "../wabisator-types";

const status = statusEnv.result as unknown as CoordinatorsStatus;

describe("parseRemaining", () => {
  it("parses positive, negative and junk", () => {
    expect(parseRemaining("0d 0h 1m 5s")).toBe(65);
    expect(parseRemaining("0d 0h 0m -59s")).toBe(-59);
    expect(parseRemaining("0d 0h -1m -51s")).toBe(-111);
    expect(parseRemaining("1d 2h 0m 0s")).toBe(93600);
    expect(parseRemaining("x")).toBeNull();
  });
});

describe("countdownLabel", () => {
  it("shows time, closing or unknown", () => {
    expect(countdownLabel(10_500, 0)).toEqual({ kind: "time", seconds: 11 });
    expect(countdownLabel(0, 0)).toEqual({ kind: "closing" });
    expect(countdownLabel(-59_000, 0)).toEqual({ kind: "closing" });
    expect(countdownLabel(null, 0)).toEqual({ kind: "unknown" });
  });
});

describe("buildBoard", () => {
  const at = 1_000_000;
  const { active, inactive } = buildBoard(status, at);
  it("splits active and inactive, sorted by 24 h volume", () => {
    expect(active.length + inactive.length).toBe(status.Coordinators.length);
    for (let i = 1; i < active.length; i++) expect(active[i - 1]!.volume24h).toBeGreaterThanOrEqual(active[i]!.volume24h);
    expect(active[0]!.key).toBe("kruw");
    expect(inactive.map((c) => c.key).sort()).toEqual(["openwasabi", "swisscoordinator"]);
    expect(active.every((c) => c.online)).toBe(true);
  });
  it("maps phases, caps progress and computes closesAt", () => {
    const kruw = active.find((c) => c.key === "kruw")!;
    const out = kruw.rounds.find((r) => r.phase === "OutputRegistration")!;
    expect(out.phaseIndex).toBe(PHASES.indexOf("OutputRegistration"));
    expect(out.min).toBe(100);
    expect(out.inputs).toBe(244);
    expect(out.progress).toBe(1);
    expect(out.closesAt).toBe(at - 111_000);
    const ir = kruw.rounds.find((r) => r.phase === "InputRegistration")!;
    expect(ir.progress).toBeCloseTo(0.03, 9);
    expect(kruw.rounds.find((r) => r.phase === "Ended")!.blame).toBe(true);
    expect(kruw.rules.map((r) => r.label)).toEqual(["Minimum Inputs", "Allowed Input Types", "Allowed Input Amounts", "Mining Fee Rate"]);
  });
  it("anchors countdowns at the snapshot's UpdatedAt, not at a later receipt", () => {
    const updated = Date.parse(status.UpdatedAt);
    const late = buildBoard(status, updated + 25_000).active.find((c) => c.key === "kruw")!;
    expect(late.rounds.find((r) => r.phase === "OutputRegistration")!.closesAt).toBe(updated - 111_000);
    // A client clock 5 min fast: the server time is not trusted, so the open rounds still count down.
    const fast = updated + 5 * 60_000;
    const skewed = buildBoard(status, fast).active.flatMap((c) => c.rounds).filter((r) => r.phase === "InputRegistration");
    expect(skewed.some((r) => countdownLabel(r.closesAt, fast).kind === "time")).toBe(true);
    expect(buildBoard(status, fast).active.find((c) => c.key === "kruw")!.rounds.find((r) => r.phase === "OutputRegistration")!.closesAt).toBe(fast - 111_000);
    const bad = buildBoard({ ...status, UpdatedAt: "" }, at).active.find((c) => c.key === "kruw")!;
    expect(bad.rounds.find((r) => r.phase === "OutputRegistration")!.closesAt).toBe(at - 111_000);
  });
  it("keeps only http(s) ReadMore links", () => {
    const base = status.Coordinators.find((c) => c.Key === "kruw")!;
    const link = (ReadMore: string) => buildBoard({ ...status, Coordinators: [{ ...base, ReadMore }] }, at).active[0]!.readMore;
    expect(link("javascript:alert(1)")).toBe("");
    expect(link("/relative")).toBe("");
    expect(link("https://kruw.io")).toBe("https://kruw.io");
  });
  it("falls back to Config minimum, then 0, when AbsoluteMinInputCount is null", () => {
    const base = status.Coordinators.find((c) => c.Key === "kruw")!;
    const fromConfig = buildBoard({ ...status, Coordinators: [{ ...base, AbsoluteMinInputCount: null }] }, at).active[0]!;
    expect(fromConfig.rounds[0]!.min).toBe(100);
    const unknown = buildBoard({ ...status, Coordinators: [{ ...base, AbsoluteMinInputCount: null, Config: null }] }, at).active[0]!;
    expect(unknown.rounds[0]!.min).toBe(0);
    expect(unknown.rounds[0]!.progress).toBe(0);
    expect(unknown.rules).toEqual([]);
  });
  it("gives a null closesAt for an unparseable remaining", () => {
    const base = status.Coordinators.find((c) => c.Key === "kruw")!;
    const c = buildBoard({ ...status, Coordinators: [{ ...base, RoundStates: [{ ...base.RoundStates[0]!, InputRegistrationRemaining: "soon" }] }] }, at).active[0]!;
    expect(c.rounds[0]!.closesAt).toBeNull();
  });
});
