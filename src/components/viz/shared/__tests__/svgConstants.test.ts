import { describe, it, expect } from "vitest";
import { DARK_SURFACES } from "../svgConstants";
import { SCRIPT_TYPE_COLORS } from "../../graph/scriptStyles";

describe("colour constants", () => {
  it("dark surfaces keep the dark theme values", () => {
    expect(DARK_SURFACES).toEqual({
      background: "#0b0b0d",
      foreground: "#f2f2f4",
      muted: "#a6a6b0",
      cardBg: "#17171b",
      cardBorder: "#444450",
      surfaceInset: "#111114",
      surfaceElevated: "#1d1d22",
    });
  });

  it("script type edges keep their OXT colours", () => {
    expect(SCRIPT_TYPE_COLORS).toMatchObject({
      p2pk: "#28d065",
      p2pkh: "#28d065",
      v0_p2wpkh: "#60a5fa",
      p2sh: "#f97316",
      "p2sh-p2wpkh": "#f97316",
      "p2sh-p2wsh": "#f97316",
      multisig: "#f97316",
    });
  });
});
