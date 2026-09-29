/**
 * WabiSabi (Wasabi Wallet 2.x protocol) CoinJoin classifier.
 *
 * One pure function shared by every consumer (H4 finding, CoinJoin
 * suppressions, tx type, Boltzmann turbo routing), so they all agree on what
 * a WabiSabi round is. It only says "WabiSabi" when the transaction carries
 * the structure the coordinator code produces; anything else that merely
 * looks collaborative falls back to the generic CoinJoin detectors.
 *
 * Protocol facts (WalletWasabi source, identical in v2.0.0.0 and master, and
 * in the Ginger Wallet fork; Trezor Suite and the BTCPay plugin run the same
 * WalletWasabi code):
 * - Standard denominations: 2^n, 3^n, 2*3^n, 10^n, 2*10^n, 5*10^n satoshis
 *   between the round's min and max allowed output amounts
 *   (DenominationBuilder.CreateDenominationAmounts). Outputs carry the exact
 *   denomination (Output.FromDenomination). Non-standard outputs are change
 *   (at most one per participant), payments and the coordinator output.
 * - Inputs are ordered by amount descending, outputs are merged per
 *   scriptPubKey and ordered by value descending (SigningState.SortedInputs /
 *   SortedOutputs), so no two outputs share a script.
 * - The transaction is built with NBitcoin defaults: nSequence final on
 *   every input, nLockTime 0 (RoundParameters.CreateTransaction).
 * - Inputs may only be P2WPKH or P2TR (WabiSabiConfig.AllowP2wpkhInputs /
 *   AllowP2trInputs); clients decompose into P2WPKH / P2TR outputs.
 * See docs/privacy-engine.md (H4, WabiSabi) for links and the evaluation.
 */

/**
 * Lowest standard denomination considered. The default coordinator minimum
 * is 5,000 sats, but coordinators may lower it (coinjoin.nl rounds carry
 * 2,187 = 3^7 and 4,374 = 2*3^7 sat denominations).
 */
const MIN_DENOMINATION = 1_000;
/** Default MaxRegistrableAmount (43,000 BTC). */
const MAX_DENOMINATION = 43_000 * 100_000_000;

function buildDenominations(): { all: Set<number>; decimal: Set<number> } {
  const all = new Set<number>();
  const decimal = new Set<number>();
  const series = (base: number, times: number, into: Set<number>[]) => {
    for (let p = 1; p * times <= MAX_DENOMINATION; p *= base) {
      if (p * times >= MIN_DENOMINATION) for (const s of into) s.add(p * times);
    }
  };
  series(2, 1, [all]);
  series(3, 1, [all]);
  series(3, 2, [all]);
  series(10, 1, [all, decimal]);
  series(10, 2, [all, decimal]);
  series(10, 5, [all, decimal]);
  return { all, decimal };
}

const DENOMS = buildDenominations();

/** Whether a value is a WabiSabi standard denomination. */
export function isStandardDenomination(value: number): boolean {
  return DENOMS.all.has(value);
}

/**
 * Standard denominations outside the 1-2-5 decimal series (powers of 2, 3
 * and 2*3^n). People pay round decimal amounts all the time (exchange
 * withdrawals, payroll, Whirlpool pools); nobody pays 8,388,608 or 4,782,969
 * sats, so these values are the denomination set's real fingerprint.
 */
function isNonDecimalDenomination(value: number): boolean {
  return DENOMS.all.has(value) && !DENOMS.decimal.has(value);
}

const ALLOWED_TYPES = new Set(["v0_p2wpkh", "v1_p2tr"]);
const FINAL_SEQUENCE = 0xffffffff;

/** Minimal transaction shape the classifier reads (MempoolTransaction fits). */
export interface WabiSabiTxLike {
  locktime?: number;
  vin: Array<{
    is_coinbase?: boolean;
    sequence?: number;
    prevout?: { value: number; scriptpubkey_type?: string } | null;
  }>;
  vout: Array<{ value: number; scriptpubkey_type?: string; scriptpubkey?: string }>;
}

export interface WabiSabiEvidence {
  inputs: number;
  outputs: number;
  /** Outputs at an exact standard denomination. */
  standardOutputs: number;
  /** Standard outputs outside the decimal 1-2-5 series. */
  nonDecimalOutputs: number;
  /** Distinct standard denominations present. */
  tiers: number;
  /** Distinct non-decimal standard denominations present. */
  nonDecimalTiers: number;
  /** Outputs that are not standard denominations (change, payments, coordinator). */
  otherOutputs: number;
}

export interface WabiSabiClassification {
  isWabiSabi: boolean;
  /** "high" for full-size rounds, "medium" for small rounds that barely clear the thresholds. */
  confidence: "high" | "medium" | null;
  /** First protocol rule the transaction breaks (null when it is WabiSabi). */
  failed: string | null;
  evidence: WabiSabiEvidence;
}

/** Smallest round accepted: below this the ordering/denomination evidence is too thin. */
const MIN_INPUTS = 5;
const MIN_OUTPUTS = 5;
/** Share of outputs that must be exact standard denominations (lowest seen in real rounds: 0.71). */
const MIN_STANDARD_SHARE = 0.6;
/** Non-decimal standard outputs required, and distinct standard tiers. */
const MIN_NON_DECIMAL_OUTPUTS = 2;
const MIN_TIERS = 2;

function isDescending(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if ((values[i - 1] ?? 0) < (values[i] ?? 0)) return false;
  }
  return true;
}

/**
 * Classify a transaction as a WabiSabi CoinJoin round (or not).
 *
 * Structural rules (all required): no coinbase, every input a known P2WPKH or
 * P2TR prevout, final nSequence and zero nLockTime, inputs and outputs in
 * descending value order, no two outputs to the same script, no OP_RETURN,
 * standard-denomination outputs paid to P2WPKH / P2TR.
 * Evidence rules: 5+ inputs and outputs, 60%+ of outputs at exact standard
 * denominations, 2+ distinct standard tiers and 2+ outputs at non-decimal
 * denominations (2^n, 3^n, 2*3^n).
 */
export function classifyWabiSabi(tx: WabiSabiTxLike): WabiSabiClassification {
  const outs = tx.vout;
  const values = outs.map((o) => o.value);
  const counts = new Map<number, number>();
  for (const v of values) if (isStandardDenomination(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
  const standardOutputs = [...counts.values()].reduce((a, b) => a + b, 0);
  const nonDecimal = [...counts].filter(([v]) => isNonDecimalDenomination(v));
  const evidence: WabiSabiEvidence = {
    inputs: tx.vin.length,
    outputs: outs.length,
    standardOutputs,
    nonDecimalOutputs: nonDecimal.reduce((a, [, c]) => a + c, 0),
    tiers: counts.size,
    nonDecimalTiers: nonDecimal.length,
    otherOutputs: outs.length - standardOutputs,
  };

  const fail = (failed: string): WabiSabiClassification => ({ isWabiSabi: false, confidence: null, failed, evidence });

  if (tx.vin.length < MIN_INPUTS || outs.length < MIN_OUTPUTS) return fail("too-small");
  if (tx.vin.some((v) => v.is_coinbase || !v.prevout)) return fail("input-type");
  if (tx.vin.some((v) => !ALLOWED_TYPES.has(v.prevout?.scriptpubkey_type ?? ""))) return fail("input-type");
  if (tx.vin.some((v) => v.sequence !== undefined && v.sequence !== FINAL_SEQUENCE)) return fail("sequence");
  if (tx.locktime !== undefined && tx.locktime !== 0) return fail("locktime");
  if (outs.some((o) => o.scriptpubkey_type === "op_return" || o.value <= 0)) return fail("op-return");
  if (!isDescending(tx.vin.map((v) => v.prevout?.value ?? 0)) || !isDescending(values)) return fail("ordering");
  const scripts = outs.flatMap((o) => (o.scriptpubkey ? [o.scriptpubkey] : []));
  if (new Set(scripts).size !== scripts.length) return fail("script-reuse");
  if (outs.some((o) => isStandardDenomination(o.value) && o.scriptpubkey_type !== undefined && !ALLOWED_TYPES.has(o.scriptpubkey_type))) {
    return fail("output-type");
  }

  if (standardOutputs < outs.length * MIN_STANDARD_SHARE) return fail("denominations");
  if (evidence.tiers < MIN_TIERS || evidence.nonDecimalOutputs < MIN_NON_DECIMAL_OUTPUTS) return fail("denominations");

  const high = tx.vin.length >= 20 && evidence.nonDecimalTiers >= 3;
  return { isWabiSabi: true, confidence: high ? "high" : "medium", failed: null, evidence };
}
