import { describe, it, expect } from "vitest";
import { EFFICIENCY_COLORS, probColor, probLabel } from "../linkabilityColors";
import en from "../../../../../public/locales/en/common.json";
import { hexToRgb } from "@/lib/palette";

// Values rendered before the ramp moved onto palette hex stops.
describe("probColor (dark ramp)", () => {
  it.each([
    [0, "rgb(17,24,39)"],
    [0.1, "rgb(13,59,79)"],
    [0.325, "rgb(23,128,86)"],
    [0.4, "rgb(40,160,101)"],
    [0.85, "rgb(220,74,42)"],
    [1, "rgb(239,68,68)"],
  ])("p=%s -> %s", (p, expected) => {
    expect(probColor(p)).toBe(expected);
  });

  it("efficiency bar colors are samples of the ramp", () => {
    expect(`rgb(${hexToRgb(EFFICIENCY_COLORS.high).join(",")})`).toBe(probColor(0.4));
    expect(`rgb(${hexToRgb(EFFICIENCY_COLORS.mid).join(",")})`).toBe(probColor(0.55));
    expect(`rgb(${hexToRgb(EFFICIENCY_COLORS.low).join(",")})`).toBe(probColor(0.7));
  });
});

describe("probLabel", () => {
  it.each([
    [1, "deterministic"], [0.8, "likely"], [0.5, "probable"], [0.3, "ambiguous"], [0.1, "unlikely"], [0, "noLink"],
  ])("%s -> %s, with a translated key", (p, key) => {
    const { key: k, label } = probLabel(p);
    expect(k).toBe(key);
    expect((en as Record<string, string>)[`boltzmann.legend.${k}`]).toBe(label);
  });
});
