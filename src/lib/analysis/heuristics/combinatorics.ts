/**
 * General-purpose combinatorial math utilities for Boltzmann entropy calculations.
 *
 * Extracted from entropy-math.ts. These functions handle factorials,
 * integer partitions, log-space binomial coefficients, and the Boltzmann
 * partition formula for equal-value CoinJoin outputs.
 */

// ---- Memoized factorial ----------------------------------------------------

const factorialCache: number[] = [1, 1];

export function factorial(n: number): number {
  // Negative or non-integer n has no cache entry: NaN, as the arithmetic always yielded.
  if (n < factorialCache.length) return factorialCache[n] ?? NaN;
  let result = factorialCache[factorialCache.length - 1]!; // cache is seeded [1, 1] and only grows
  for (let i = factorialCache.length; i <= n; i++) {
    result *= i;
    factorialCache[i] = result;
  }
  return result;
}

// ---- Log-space math --------------------------------------------------------

/** Compute log2(n!) using sum of logs (overflow-safe). */
export function log2Factorial(n: number): number {
  let result = 0;
  for (let i = 2; i <= n; i++) result += Math.log2(i);
  return result;
}

/** Compute log2 of the binomial coefficient C(n, k) using log-sum of factorials. */
export function log2Binomial(n: number, k: number): number {
  if (k > n || k < 0) return 0;
  if (k === 0 || k === n) return 0;
  // log2(C(n,k)) = sum(log2(i), i=k+1..n) - sum(log2(i), i=1..n-k)
  let result = 0;
  for (let i = 1; i <= n - k; i++) {
    result += Math.log2(k + i) - Math.log2(i);
  }
  return result;
}

// ---- Integer partition generator -------------------------------------------

/**
 * Generate all integer partitions of n.
 * A partition is a list of positive integers that sum to n, in non-increasing order.
 * E.g., partitions(4) = [[4], [3,1], [2,2], [2,1,1], [1,1,1,1]]
 *
 * For n <= 50, this produces at most ~204,226 partitions - trivially fast.
 */
export function integerPartitions(n: number): number[][] {
  const result: number[][] = [];

  function generate(remaining: number, maxPart: number, current: number[]): void {
    if (remaining === 0) {
      result.push([...current]);
      return;
    }
    for (let part = Math.min(remaining, maxPart); part >= 1; part--) {
      current.push(part);
      generate(remaining - part, part, current);
      current.pop();
    }
  }

  generate(n, n, []);
  return result;
}

// ---- Boltzmann partition formula -------------------------------------------

/**
 * Compute the number of valid interpretations for n equal inputs and n equal
 * outputs using the Boltzmann partition formula.
 *
 * For each integer partition (s1, s2, ..., sk) of n:
 *   term = n!^2 / (prod(si!^2) * prod(mj!))
 * where mj = multiplicity of each distinct part size.
 *
 * Total N = sum of all terms.
 *
 * Reference values:
 *   n=2: 3, n=3: 16, n=4: 131, n=5: 1,496, n=6: 22,482,
 *   n=7: 426,833, n=8: 9,934,563, n=9: ~277,006,192
 */
export function boltzmannEqualOutputs(n: number): number {
  const partitions = integerPartitions(n);

  // boltzmannExact computes (n!)^2 which exceeds MAX_SAFE_INTEGER for n > 12.
  // Use exact arithmetic only for small n; log-space avoids precision loss.
  if (n <= 12) {
    return boltzmannExact(n, partitions);
  }
  // Return 2^(log2 result) for larger n
  const log2Total = boltzmannLog2(n, partitions);
  return Math.pow(2, log2Total);
}

/** Exact Boltzmann partition count for small n (n <= 13). */
function boltzmannExact(n: number, partitions: number[][]): number {
  const nFact = factorial(n);
  const nFactSquared = nFact * nFact;
  let total = 0;

  for (const partition of partitions) {
    let prodPartFactSquared = 1;
    for (const part of partition) {
      const pf = factorial(part);
      prodPartFactSquared *= pf * pf;
    }

    const multiplicities = new Map<number, number>();
    for (const part of partition) {
      multiplicities.set(part, (multiplicities.get(part) ?? 0) + 1);
    }

    let prodMultFact = 1;
    for (const m of multiplicities.values()) {
      prodMultFact *= factorial(m);
    }

    total += nFactSquared / (prodPartFactSquared * prodMultFact);
  }

  return Math.round(total);
}

/** Log2 of Boltzmann partition count for large n (n > 12). Uses log-space to avoid factorial overflow. */
function boltzmannLog2(n: number, partitions: number[][]): number {
  const log2nFact = log2Factorial(n);
  const log2nFactSquared = 2 * log2nFact;

  // Use log-sum-exp: log2(sum(2^xi)) = max(xi) + log2(sum(2^(xi - max)))
  const logTerms: number[] = [];

  for (const partition of partitions) {
    let log2Denom = 0;
    for (const part of partition) {
      log2Denom += 2 * log2Factorial(part);
    }

    const multiplicities = new Map<number, number>();
    for (const part of partition) {
      multiplicities.set(part, (multiplicities.get(part) ?? 0) + 1);
    }
    for (const m of multiplicities.values()) {
      log2Denom += log2Factorial(m);
    }

    logTerms.push(log2nFactSquared - log2Denom);
  }

  // Log-sum-exp for numerical stability (loop-based max to avoid stack overflow with large arrays)
  let maxLog = -Infinity;
  for (const lt of logTerms) {
    if (lt > maxLog) maxLog = lt;
  }
  let sumExp = 0;
  for (const lt of logTerms) {
    sumExp += Math.pow(2, lt - maxLog);
  }
  return maxLog + Math.log2(sumExp);
}

/**
 * Estimate Boltzmann entropy for large n using asymptotic approximation.
 * Based on the observation that log2(N) grows roughly as 2*n*log2(n) - n*log2(e).
 */
export function estimateBoltzmannEntropy(n: number): number {
  // For large n, the dominant partition is the all-ones partition giving (n!)^2 / n!
  // = n!, and there are many more partitions. Use a conservative estimate.
  let logN = 0;
  for (let i = 2; i <= n; i++) logN += Math.log2(i);
  // The all-ones partition contributes n! interpretations.
  // Other partitions add roughly 50-80% more. Scale by ~1.7x for a reasonable estimate.
  return logN + Math.log2(1.7);
}
