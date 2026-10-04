/** Vose alias method, matching ur-js RandomSampler. */
export class RandomSampler {
  private prob: number[];
  private alias: number[];
  constructor(probs: number[]) {
    const n = probs.length;
    const sum = probs.reduce((a, b) => a + b, 0);
    const P = probs.map((p) => (p * n) / sum);
    this.prob = new Array<number>(n).fill(0);
    this.alias = new Array<number>(n).fill(0);
    const S: number[] = [];
    const L: number[] = [];
    for (let i = n - 1; i >= 0; i--) (P[i]! < 1 ? S : L).push(i);
    while (S.length > 0 && L.length > 0) {
      const a = S.pop()!;
      const g = L.pop()!;
      this.prob[a] = P[a]!;
      this.alias[a] = g;
      P[g] = P[g]! + P[a]! - 1;
      (P[g]! < 1 ? S : L).push(g);
    }
    while (L.length > 0) this.prob[L.pop()!] = 1;
    while (S.length > 0) this.prob[S.pop()!] = 1;
  }
  next(rng: () => number): number {
    const r1 = rng();
    const r2 = rng();
    const i = Math.floor(this.prob.length * r1);
    return r2 < this.prob[i]! ? i : this.alias[i]!;
  }
}
