import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseSummaryHtml,
  parseStatsCsv,
  downsample,
} from "../parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "fixtures/whirlpoolstats.html"), "utf8");
const csv = readFileSync(join(here, "fixtures/whirlpool_stats.head-tail.csv"), "utf8");

describe("parseSummaryHtml", () => {
  let parsed;
  beforeAll(() => {
    parsed = parseSummaryHtml(html);
  });

  it("does not return an error envelope on the real fixture", () => {
    expect(parsed.error).toBeUndefined();
  });

  it("extracts title and overall totals", () => {
    expect(parsed.title).toBe("Ashigaru Whirlpool Statistics");
    expect(parsed.total_entered_btc).toBeGreaterThan(100);
  });

  it("extracts two pools with denomination + cycles + lifetime entered", () => {
    expect(parsed.pools).toHaveLength(2);
    const small = parsed.pools.find((p) => p.pool === "0.025_BTC_Pool");
    const large = parsed.pools.find((p) => p.pool === "0.25_BTC_Pool");
    expect(small).toBeTruthy();
    expect(large).toBeTruthy();
    expect(small.denomination_btc).toBe(0.025);
    expect(large.denomination_btc).toBe(0.25);
    expect(small.cycles).toBeGreaterThan(0);
    expect(large.cycles).toBeGreaterThan(0);
    expect(small.total_entered_btc).toBeGreaterThan(0);
    expect(large.total_entered_btc).toBeGreaterThan(0);
    expect(small.color).toMatch(/^#/);
    expect(small.label).toBe("0.025 BTC Pool");
  });

  it("extracts a parseable ISO timestamp", () => {
    expect(parsed.last_updated_iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(new Date(parsed.last_updated_iso).getTime()).not.toBeNaN();
  });

  it("extracts strictly numeric block range", () => {
    expect(parsed.start_block_height).toBeGreaterThan(800_000);
    expect(parsed.tip_block_height).toBeGreaterThan(parsed.start_block_height);
  });

  it("returns PARSER_HTML with fields_missing when total is absent", () => {
    const broken = html.replace(/Total BTC in Ashigaru Whirlpool/g, "Some Other Header");
    const out = parseSummaryHtml(broken);
    expect(out.error?.code).toBe("PARSER_HTML");
    expect(out.error?.fields_missing).toContain("total_entered_btc");
  });

  it("returns PARSER_HTML when the timestamp can't be parsed", () => {
    const broken = html.replace(/Last Updated[\s\S]*?\d{4}/, "Last Updated NOT A DATE");
    const out = parseSummaryHtml(broken);
    expect(out.error?.code).toBe("PARSER_HTML");
  });
});

describe("parseStatsCsv", () => {
  let parsed;
  beforeAll(() => {
    parsed = parseStatsCsv(csv);
  });

  it("returns a charts payload, not an error", () => {
    expect(parsed.error).toBeUndefined();
  });

  it("has blocks in strictly increasing order", () => {
    for (let i = 1; i < parsed.blocks.length; i++) {
      expect(parsed.blocks[i]).toBeGreaterThan(parsed.blocks[i - 1]);
    }
  });

  it("has capacity series matching block count, both pools", () => {
    expect(parsed.capacity_btc["0.025_BTC_Pool"].length).toBe(parsed.blocks.length);
    expect(parsed.capacity_btc["0.25_BTC_Pool"].length).toBe(parsed.blocks.length);
  });

  it("returns PARSER_CSV error for short input", () => {
    const out = parseStatsCsv("899205,0.05,0.0\n899206,0.05,0.0\n");
    expect(out.error?.code).toBe("PARSER_CSV");
  });

  it("skips rows with empty or NaN columns", () => {
    const noisy = csv + "\n\n951953,,\n951954,NaN,5\n";
    const out = parseStatsCsv(noisy);
    expect(out.error).toBeUndefined();
    expect(out.blocks).not.toContain(951953);
    expect(out.blocks).not.toContain(951954);
  });

  it("keeps the LAST numeric row when a block appears multiple times", () => {
    // Synthesize: same block height with two different values; last wins.
    let synthetic = "";
    for (let b = 1000; b < 1200; b++) synthetic += `${b},1.0,2.0\n`;
    synthetic += "1199,9.9,8.8\n"; // overrides the prior 1199,1.0,2.0
    const out = parseStatsCsv(synthetic);
    expect(out.error).toBeUndefined();
    const idx = out.blocks.indexOf(1199);
    expect(out.capacity_btc["0.025_BTC_Pool"][idx]).toBe(9.9);
    expect(out.capacity_btc["0.25_BTC_Pool"][idx]).toBe(8.8);
  });
});

describe("downsample", () => {
  it("is a no-op below the max points threshold", () => {
    const c = { blocks: [1, 2, 3, 4], capacity_btc: { p: [10, 11, 12, 13] } };
    expect(downsample(c, 100)).toEqual(c);
  });

  it("shrinks to <= maxPoints + 1 (with last sample preserved)", () => {
    const n = 5000;
    const c = {
      blocks: Array.from({ length: n }, (_, i) => 1000 + i),
      capacity_btc: { p: Array.from({ length: n }, (_, i) => i * 0.1) },
    };
    const out = downsample(c, 200);
    expect(out.blocks.length).toBeLessThanOrEqual(201);
    expect(out.blocks[0]).toBe(c.blocks[0]);
    expect(out.blocks[out.blocks.length - 1]).toBe(c.blocks[n - 1]);
    expect(out.capacity_btc.p.length).toBe(out.blocks.length);
  });
});
