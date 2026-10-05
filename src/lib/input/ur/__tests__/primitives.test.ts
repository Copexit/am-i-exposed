import { describe, it, expect } from "vitest";
import { crc32 } from "../crc32";
import { decodeMinimalBytewords, WORDS } from "../bytewords";
import { Xoshiro, seedFor } from "../xoshiro";
import { RandomSampler } from "../sampler";
import { decodeCbor } from "../cbor";
// Reference implementation (dev dependency) for cross-checks
import { UR, UREncoder } from "@ngraveio/bc-ur";

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("bytewords", () => {
  it("has 256 unique minimal forms", () => {
    expect(WORDS).toHaveLength(256);
    expect(WORDS[0]).toBe("able");
    expect(WORDS[255]).toBe("zoom");
    expect(new Set(WORDS.map((w) => w[0]! + w[3]!)).size).toBe(256);
  });
  it("decodes the reference encoder's single-part UR body", () => {
    // UR.fromBuffer wraps the buffer as a CBOR byte string: 0x44 = bytes(4)
    const body = new UREncoder(UR.fromBuffer(Buffer.from([1, 2, 3, 4])), 1000).nextPart().split("/").pop()!;
    expect(Array.from(decodeMinimalBytewords(body))).toEqual([0x44, 1, 2, 3, 4]);
  });
  it("rejects a bad checksum", () => {
    const body = new UREncoder(UR.fromBuffer(Buffer.from([0x41, 9])), 1000).nextPart().split("/").pop()!;
    const broken = body.slice(0, -2) + (body.endsWith("ae") ? "ad" : "ae");
    expect(() => decodeMinimalBytewords(broken)).toThrow();
  });
});

describe("xoshiro + sampler", () => {
  it("is deterministic and in range", () => {
    const a = new Xoshiro(seedFor(5, 0x12345678));
    const b = new Xoshiro(seedFor(5, 0x12345678));
    const xs = Array.from({ length: 20 }, () => a.nextInt(1, 10));
    expect(xs).toEqual(Array.from({ length: 20 }, () => b.nextInt(1, 10)));
    expect(xs.every((x) => x >= 1 && x <= 10)).toBe(true);
  });
  it("sampler returns valid indexes", () => {
    const rng = new Xoshiro(seedFor(1, 1));
    const s = new RandomSampler([1, 1 / 2, 1 / 3, 1 / 4]);
    for (let i = 0; i < 100; i++) expect(s.next(() => rng.nextDouble())).toBeLessThan(4);
  });
});

describe("cbor", () => {
  it("decodes bytes, text, arrays, maps, tags, ints, bools", () => {
    // tag 303 { 3: h'01', 6: tag 304 { 1: [44, true] }, 8: 0x11223344 }
    const bytes = Uint8Array.from([0xd9, 0x01, 0x2f, 0xa3, 0x03, 0x41, 0x01, 0x06, 0xd9, 0x01, 0x30, 0xa1, 0x01, 0x82, 0x18, 0x2c, 0xf5, 0x08, 0x1a, 0x11, 0x22, 0x33, 0x44]);
    const v = decodeCbor(bytes) as { tag: number; value: Map<number, unknown> };
    expect(v.tag).toBe(303);
    expect(v.value.get(8)).toBe(0x11223344);
    expect((v.value.get(6) as { tag: number }).tag).toBe(304);
  });
  it("throws on trailing bytes", () => {
    expect(() => decodeCbor(Uint8Array.from([0x01, 0x02]))).toThrow();
  });
});
