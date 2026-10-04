import { crc32 } from "./crc32";
import { decodeCbor } from "./cbor";
import { RandomSampler } from "./sampler";
import { Xoshiro, seedFor } from "./xoshiro";

export interface FountainPart { seqNum: number; seqLen: number; messageLen: number; checksum: number; fragment: Uint8Array }

export function parsePart(cbor: Uint8Array): FountainPart {
  const v = decodeCbor(cbor);
  if (!Array.isArray(v) || v.length !== 5) throw new Error("corrupt");
  const [seqNum, seqLen, messageLen, checksum, fragment] = v;
  if (typeof seqNum !== "number" || typeof seqLen !== "number" || typeof messageLen !== "number" || typeof checksum !== "number" || !(fragment instanceof Uint8Array)) throw new Error("corrupt");
  return { seqNum, seqLen, messageLen, checksum, fragment };
}

function shuffle<T>(items: T[], rng: Xoshiro): T[] {
  const remaining = [...items];
  const out: T[] = [];
  while (remaining.length > 0) out.push(remaining.splice(rng.nextInt(0, remaining.length - 1), 1)[0]!);
  return out;
}

/** Fragment indexes mixed into part `seqNum` (BCR-2020-005 chooseFragments). */
export function chooseFragments(seqNum: number, seqLen: number, checksum: number): number[] {
  if (seqNum <= seqLen) return [seqNum - 1];
  const rng = new Xoshiro(seedFor(seqNum, checksum));
  const sampler = new RandomSampler(Array.from({ length: seqLen }, (_, i) => 1 / (i + 1)));
  const degree = sampler.next(() => rng.nextDouble()) + 1;
  return shuffle(Array.from({ length: seqLen }, (_, i) => i), rng).slice(0, degree);
}

const xorInto = (a: Uint8Array, b: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = a[i]! ^ b[i]!; };

export class FountainDecoder {
  private key: string | null = null;
  private simple = new Map<number, Uint8Array>();
  private mixed: { idx: Set<number>; data: Uint8Array }[] = [];
  private seqLen = 0;
  private messageLen = 0;
  private checksum = 0;

  /** Returns the message when complete, else null. Throws "corrupt" on checksum failure. */
  receive(p: FountainPart): Uint8Array | null {
    const key = `${p.seqLen}:${p.messageLen}:${p.checksum}`;
    if (key !== this.key) {
      this.key = key; this.simple.clear(); this.mixed = [];
      this.seqLen = p.seqLen; this.messageLen = p.messageLen; this.checksum = p.checksum;
    }
    this.add(new Set(chooseFragments(p.seqNum, p.seqLen, p.checksum)), p.fragment.slice());
    if (this.simple.size < this.seqLen) return null;
    const joined = new Uint8Array(this.seqLen * this.simple.get(0)!.length);
    for (let i = 0; i < this.seqLen; i++) joined.set(this.simple.get(i)!, i * this.simple.get(0)!.length);
    const msg = joined.slice(0, this.messageLen);
    if (crc32(msg) !== this.checksum) { this.key = null; throw new Error("corrupt"); }
    return msg;
  }

  get progress(): number {
    return this.seqLen ? this.simple.size / this.seqLen : 0;
  }

  private add(idx: Set<number>, data: Uint8Array) {
    type Part = { idx: Set<number>; data: Uint8Array };
    const queue: Part[] = [{ idx, data }];
    const subset = (a: Set<number>, b: Set<number>) => [...a].every((x) => b.has(x));
    const reduce = (t: Part, by: Part) => { for (const x of by.idx) t.idx.delete(x); xorInto(t.data, by.data); };
    while (queue.length > 0) {
      const cur = queue.pop()!;
      for (const [i, frag] of this.simple) if (cur.idx.has(i)) reduce(cur, { idx: new Set([i]), data: frag });
      if (cur.idx.size === 0) continue;
      if (cur.idx.size === 1) {
        const i = [...cur.idx][0]!;
        if (this.simple.has(i)) continue;
        this.simple.set(i, cur.data);
        queue.push(...this.mixed); // re-reduce everything pending against the new fragment
        this.mixed = [];
        continue;
      }
      // reduce against (or by) pending mixed parts whose index sets nest, as the reference decoder does
      const pos = this.mixed.findIndex((m) => subset(m.idx, cur.idx) || subset(cur.idx, m.idx));
      if (pos < 0) { this.mixed.push(cur); continue; }
      const m = this.mixed[pos]!;
      if (subset(m.idx, cur.idx)) { reduce(cur, m); queue.push(cur); } else { this.mixed.splice(pos, 1); reduce(m, cur); queue.push(m, cur); }
    }
  }
}
