import { sha256 } from "@noble/hashes/sha2.js";

const MASK = (1n << 64n) - 1n;
const rotl = (x: bigint, k: bigint) => ((x << k) | (x >> (64n - k))) & MASK;

/** 8-byte seed: u32be(seqNum) || u32be(checksum). The Xoshiro constructor hashes it. */
export function seedFor(seqNum: number, checksum: number): Uint8Array {
  const b = new Uint8Array(8);
  const v = new DataView(b.buffer);
  v.setUint32(0, seqNum);
  v.setUint32(4, checksum);
  return b;
}

/** Xoshiro256** seeded with SHA-256(seed), as in BCR-2020-005 / ur-js. */
export class Xoshiro {
  private s: bigint[] = [0n, 0n, 0n, 0n];
  constructor(seed: Uint8Array) {
    const d = sha256(seed);
    for (let i = 0; i < 4; i++) {
      let v = 0n;
      for (let n = 0; n < 8; n++) v = (v << 8n) | BigInt(d[i * 8 + n]!);
      this.s[i] = v;
    }
  }
  next(): bigint {
    const s = this.s as [bigint, bigint, bigint, bigint];
    const result = (rotl((s[1] * 5n) & MASK, 7n) * 9n) & MASK;
    const t = (s[1] << 17n) & MASK;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 45n);
    return result;
  }
  nextDouble(): number {
    return Number(this.next()) / 2 ** 64;
  }
  nextInt(low: number, high: number): number {
    return Math.floor(this.nextDouble() * (high - low + 1)) + low;
  }
}
