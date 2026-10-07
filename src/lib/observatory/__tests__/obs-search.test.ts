import { describe, it, expect } from "vitest";
import flow1dEnv from "./fixtures/wabisator/flow-map-1d.json";
import { parseSearch, resolveSearch } from "../obs-search";
import { buildScene } from "../sky-model";
import type { FlowMap } from "../wabisator-types";

const flow1d = flow1dEnv.result as unknown as FlowMap;
const scene = buildScene(flow1d, null);
const now = scene.until;
const ymd = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

describe("parseSearch", () => {
  it("accepts txids, dates and rejects junk", () => {
    const tx = flow1d.Coinjoins[0]!.TxId;
    expect(parseSearch(`  ${tx.toUpperCase()} `)).toEqual({ kind: "txid", txid: tx });
    expect(parseSearch("2026-10-06")).toEqual({ kind: "date", t: Date.UTC(2026, 9, 6) / 1000 });
    expect(parseSearch("2026-10-06 12:30")).toEqual({ kind: "date", t: Date.UTC(2026, 9, 6, 12, 30) / 1000 });
    for (const bad of ["hello", "2026-02-30", "2026-10-06 25:00", "g".repeat(64), "a".repeat(63), ""]) expect(parseSearch(bad)).toEqual({ kind: "invalid" });
  });
});

describe("resolveSearch", () => {
  it("finds a loaded txid, misses an unknown one", () => {
    const tx = flow1d.Coinjoins[5]!.TxId;
    const r = resolveSearch(parseSearch(tx), scene, now);
    expect(r.kind === "found" && r.event.txid).toBe(tx);
    expect(resolveSearch(parseSearch("0".repeat(64)), scene, now)).toEqual({ kind: "not-found", txid: "0".repeat(64) });
  });
  it("locates dates relative to the period", () => {
    const inside = parseSearch(new Date((scene.since + 3600) * 1000).toISOString().slice(0, 16).replace("T", " "));
    expect(resolveSearch(inside, scene, now).kind).toBe("in-period");
    expect(resolveSearch(parseSearch(ymd(now - 20 * 86400)), scene, now)).toMatchObject({ kind: "out-of-period", suggested: 30 });
    expect(resolveSearch(parseSearch(ymd(now - 40 * 86400)), scene, now)).toMatchObject({ kind: "out-of-period", suggested: null });
    expect(resolveSearch(parseSearch("junk"), scene, now)).toEqual({ kind: "invalid" });
  });
});
