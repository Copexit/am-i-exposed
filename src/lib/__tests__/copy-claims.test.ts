import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const load = (l: string): Record<string, string> =>
  JSON.parse(readFileSync(join(process.cwd(), "public/locales", l, "common.json"), "utf8"));

describe("copy claims (broadcast is opt-in)", () => {
  const en = load("en");

  it("no en value claims nothing is sent without the broadcast caveat", () => {
    const bad = Object.entries(en).filter(
      ([, v]) => /nothing (is|was) (ever )?sent/i.test(v) && !/unless you choose/i.test(v),
    );
    expect(bad).toEqual([]);
  });

  it("no en value claims no data is sent to any server", () => {
    const bad = Object.entries(en).filter(([, v]) => /no data is sent to any server/i.test(v));
    expect(bad).toEqual([]);
  });

  it("no en value says only lookups leave the browser without mentioning broadcast", () => {
    const bad = Object.entries(en).filter(
      ([, v]) => /only .*leaves? this browser/i.test(v) && !/broadcast/i.test(v),
    );
    expect(bad).toEqual([]);
  });

  it("welcome.not_p2 and home.how_lead_muted mention broadcast", () => {
    expect(en["welcome.not_p2"]).toMatch(/broadcast/i);
    expect(en["home.how_lead_muted"]).toMatch(/broadcast/i);
  });

  it("faq.a_data mentions broadcast", () => {
    expect(en["faq.a_data"]).toMatch(/broadcast/i);
  });

  it.each(["es", "de", "fr", "pt", "pl"])("%s faq.a_data and psbt banner updated", (l) => {
    const t = load(l);
    expect(t["faq.a_data"]).not.toBe(en["faq.a_data"]);
    expect(t["faq.a_data"]).toMatch(/mempool\.space/);
    expect(t["scan.sourcePsbt"]).not.toBe(en["scan.sourcePsbt"]);
  });
});
