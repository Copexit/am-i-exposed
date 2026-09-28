import { describe, it, expect } from "vitest";
import { computeCellVisuals } from "../heatmapHelpers";

describe("computeCellVisuals on a timed-out result", () => {
  it("shows every cell as N/A: partial counts prove neither 100% nor 0%", () => {
    for (const p of [1, 0, 0.5]) {
      const cell = computeCellVisuals(p, true);
      expect(cell.label).toBe("N/A");
      expect(cell.isDeterministic).toBe(false);
    }
  });

  it("keeps 100% deterministic for a complete result", () => {
    expect(computeCellVisuals(1, false)).toMatchObject({ label: "100%", isDeterministic: true });
  });
});
