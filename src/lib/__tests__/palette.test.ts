import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { COLORS, LIGHT_COLORS, hexToRgba } from "../palette";

const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");

/** Hex-valued custom properties of the first block opened by `selector`, camelCased. */
function hexVars(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block in globals.css`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6});/g)) {
    out[name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] = value.toLowerCase();
  }
  return out;
}

describe("palette mirrors globals.css", () => {
  it("dark tokens match :root", () => {
    expect(COLORS).toEqual(hexVars(":root"));
  });

  it("light tokens match html[data-theme=light]", () => {
    expect(LIGHT_COLORS).toEqual(hexVars('html[data-theme="light"]'));
  });

  it("severity tokens use the documented project values", () => {
    expect(COLORS.severityCritical).toBe("#ef4444");
    expect(COLORS.severityHigh).toBe("#f97316");
    expect(COLORS.severityMedium).toBe("#eab308");
    expect(COLORS.severityGood).toBe("#28d065");
  });
});

describe("hexToRgba", () => {
  it("converts hex to rgba", () => {
    expect(hexToRgba("#f7931a", 0.3)).toBe("rgba(247, 147, 26, 0.3)");
  });
});
