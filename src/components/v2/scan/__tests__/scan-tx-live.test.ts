import { describe, it, expect } from "vitest";
import { liveRows, MAX_ROWS } from "../ScanTxLive";

describe("liveRows", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `a${i}`, value: (i + 1) * 100 }));

  it("shows every row when they fit (never '+1 more')", () => {
    expect(liveRows(items(MAX_ROWS + 1), "o").map((r) => r.more)).not.toContain(1);
    expect(liveRows(items(MAX_ROWS + 1), "o")).toHaveLength(MAX_ROWS + 1);
  });

  it("folds the rest into one row carrying their count and value", () => {
    const rows = liveRows(items(10), "i");
    expect(rows).toHaveLength(MAX_ROWS + 1);
    const more = rows.at(-1)!;
    expect(more.more).toBe(10 - MAX_ROWS);
    expect(more.value).toBe(items(10).slice(MAX_ROWS).reduce((s, i) => s + i.value, 0));
  });

  it("shares sum to 1", () => {
    const rows = liveRows(items(7), "i");
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1);
  });
});
