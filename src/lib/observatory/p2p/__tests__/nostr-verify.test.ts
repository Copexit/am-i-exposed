import { describe, it, expect } from "vitest";
import sampleJson from "../../__tests__/fixtures/p2p/nostr/signed-sample.json";
import { verifyEvent, verifySnapshot, latestReplaceable, eventId, tag } from "../nostr-verify";
import type { NostrEvent, NostrSnapshot } from "../types";

const sample = sampleJson as unknown as NostrSnapshot;
const at = (i: number): NostrEvent => sample.events[i]!;

describe("nostr verification", () => {
  it("verifies all 12 recorded events", () => {
    expect(sample.events).toHaveLength(12);
    expect(sample.events.every((e) => verifyEvent(e))).toBe(true);
  });

  it("rejects a tampered tag, a wrong sig and a bad pubkey", () => {
    const e = structuredClone(at(0));
    expect(verifyEvent({ ...e, tags: [...e.tags, ["x", "1"]] })).toBe(false);
    expect(verifyEvent({ ...e, sig: "00".repeat(64) })).toBe(false);
    expect(verifyEvent({ ...e, pubkey: "zz" })).toBe(false);
    expect(verifyEvent({ ...e, content: "changed" })).toBe(false);
  });

  it("eventId recomputes the recorded id", () => {
    const e = at(3);
    expect(eventId(e)).toBe(e.id);
  });

  it("verifySnapshot counts rejects", () => {
    const tampered = { ...at(1), tags: [] };
    const r = verifySnapshot({ ...sample, events: [...sample.events, tampered] });
    expect(r.events).toHaveLength(12);
    expect(r.rejected).toBe(1);
  });

  it("latestReplaceable keeps newest per pubkey, kind and d", () => {
    const base: NostrEvent = { id: "a", pubkey: "p", created_at: 10, kind: 38383, tags: [["d", "x"]], content: "", sig: "" };
    const newer = { ...base, id: "b", created_at: 20 };
    const other = { ...base, id: "c", tags: [["d", "y"]] };
    const out = latestReplaceable([newer, base, other]);
    expect(out.map((e) => e.id).sort()).toEqual(["b", "c"]);
    expect(tag(newer, "d")).toEqual(["x"]);
    expect(tag(newer, "zz")).toBeUndefined();
  });
});
