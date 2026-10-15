import { describe, it, expect } from "vitest";
import { sealJson, openJson, isSealedEnvelope, WrongPasswordError, openJsonKeyed, sealJsonWithKey, openJsonWithKey } from "../envelope";

// openJson enforces >= 100000, so tests use that floor.
const OPTS = { iterations: 100000 };

describe("envelope", () => {
  it("round trips", async () => {
    const v = { a: 1, b: ["x", null], c: { d: true } };
    const env = await sealJson(v, "pw", OPTS);
    expect(isSealedEnvelope(env)).toBe(true);
    expect(await openJson(env, "pw")).toEqual(v);
  });

  it("wrong password throws WrongPasswordError", async () => {
    const env = await sealJson({ a: 1 }, "pw", OPTS);
    await expect(openJson(env, "nope")).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it("an NFD-typed password opens a file sealed with its NFC form", async () => {
    const nfc = "contrase\u00f1a-caf\u00e9";
    const nfd = nfc.normalize("NFD");
    expect(nfd).not.toBe(nfc);
    const env = await sealJson({ a: 1 }, nfc, OPTS);
    expect(await openJson(env, nfd)).toEqual({ a: 1 });
  });

  it("tampered ct throws", async () => {
    const env = await sealJson({ a: 1 }, "pw", OPTS);
    const bytes = atob(env.ct).split("");
    bytes[0] = String.fromCharCode(bytes[0]!.charCodeAt(0) ^ 1);
    await expect(openJson({ ...env, ct: btoa(bytes.join("")) }, "pw")).rejects.toThrow();
  });

  it("uses fresh salt and iv each seal", async () => {
    const a = await sealJson(1, "pw", OPTS);
    const b = await sealJson(1, "pw", OPTS);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(atob(a.salt)).toHaveLength(16);
    expect(atob(a.iv)).toHaveLength(12);
  });

  it("round trips a 2 MB payload", async () => {
    const v = { s: Array.from({ length: 2_000_000 / 8 }, (_, i) => (i * 2654435761).toString(16).slice(0, 7)).join(",") };
    const env = await sealJson(v, "pw", OPTS);
    expect(await openJson<typeof v>(env, "pw")).toEqual(v);
  });

  it("isSealedEnvelope guards", async () => {
    const env = await sealJson(1, "pw", OPTS);
    expect(isSealedEnvelope(null)).toBe(false);
    expect(isSealedEnvelope({})).toBe(false);
    expect(isSealedEnvelope({ ...env, v: 2 })).toBe(false);
    expect(isSealedEnvelope({ ...env, kdf: "x" })).toBe(false);
    expect(isSealedEnvelope({ ...env, iterations: "1" })).toBe(false);
    expect(isSealedEnvelope({ ...env, ct: 5 })).toBe(false);
  });

  it("enforces iteration bounds on open", async () => {
    const env = await sealJson(1, "pw", OPTS);
    await expect(openJson({ ...env, iterations: 99999 }, "pw")).rejects.toThrow(/invalid/i);
    await expect(openJson({ ...env, iterations: 10_000_001 }, "pw")).rejects.not.toBeInstanceOf(WrongPasswordError);
  });

  it("keyed: open returns a non-extractable key that re-seals with the same salt and a fresh IV", async () => {
    const env = await sealJson({ a: 1 }, "pw", OPTS);
    const { value, sealKey } = await openJsonKeyed(env, "pw");
    expect(value).toEqual({ a: 1 });
    expect(sealKey.key.extractable).toBe(false);
    const again = await sealJsonWithKey({ a: 2 }, sealKey);
    expect(again.salt).toBe(env.salt);
    expect(again.iv).not.toBe(env.iv);
    expect(await openJson(again, "pw")).toEqual({ a: 2 });
    expect(await openJsonWithKey(again, sealKey)).toEqual({ a: 2 });
    const other = await sealJson({ a: 3 }, "pw", OPTS);
    await expect(openJsonWithKey(other, sealKey)).rejects.toBeInstanceOf(WrongPasswordError);
  });
});
