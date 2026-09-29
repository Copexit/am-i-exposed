import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { getSpendableOutputs, countOutputValues, inputAddressSet } from "./tx-utils";
import {
  detectWhirlpool,
  detectWasabi1,
  detectEqualOutputs,
  detectJoinMarket,
  detectStonewall,
  detectSimplifiedStonewall,
} from "./coinjoin-detectors";
import {
  buildWhirlpoolFinding,
  buildWasabi1Finding,
  buildWabiSabiMultiTierFinding,
  buildJoinMarketFinding,
  buildGenericCoinJoinFinding,
  buildStonewallFinding,
  buildSimplifiedStonewallFinding,
  buildSmallJoinMarketFinding,
  buildExchangeFlaggingFinding,
} from "./coinjoin-findings";
import { detectTx0 } from "./coinjoin-premix";
import { classifyWabiSabi } from "./wabisabi";
import type { FindingId } from "@/lib/analysis/finding-metadata";

type Tx = Parameters<TxHeuristic>[0];

/**
 * outputs: spendable outputs that can belong to a CoinJoin's anonymity set,
 * i.e. not paying back to an input address (those are certainly the
 * spender's own, so they hide nothing).
 * singleOwner: every input comes from one address, so the equal-output
 * patterns cannot be a multi-party round (detectJoinMarket requires 2+ input
 * addresses for the same reason). Stonewall keeps its own input rules: solo
 * Stonewall is single-owner by design.
 */
function coinJoinCandidates(tx: Tx) {
  const inputAddresses = inputAddressSet(tx.vin);
  return {
    outputs: getSpendableOutputs(tx.vout).filter(
      (o) => !o.scriptpubkey_address || !inputAddresses.has(o.scriptpubkey_address),
    ),
    singleOwner: inputAddresses.size === 1 && tx.vin.every((v) => v.prevout?.scriptpubkey_address),
  };
}

/**
 * H4: CoinJoin Detection
 *
 * CoinJoins are the ONLY positive privacy signal. Detects:
 * - Whirlpool: exactly 5 equal outputs at known denominations
 * - Wasabi 1.x: ~0.1 BTC base denomination + mixing levels
 * - WabiSabi (Wasabi 2.x): coordinator structure + standard denominations (wabisabi.ts)
 * - Generic: many equal outputs (5+) with possible coordinator fee
 * - Equal-output pattern: general collaborative transaction detection
 *
 * Impact: +15 to +30
 */
export const analyzeCoinJoin: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  // Need at least 2 inputs and 2 outputs
  if (tx.vin.length < 2 || tx.vout.length < 2) return { findings };

  // Whirlpool tx0 (premix) has equal outputs + fee + change, which mimics a
  // small JoinMarket round. It is reported by the premix heuristic instead.
  if (detectTx0(tx)) return { findings };

  // Whirlpool matches on the unfiltered outputs: a remixer paying back to its
  // own input address is still one of the pool's 5 equal outputs.
  const whirlpool = detectWhirlpool(getSpendableOutputs(tx.vout).map((o) => o.value));
  const { outputs: spendableOutputs, singleOwner } = coinJoinCandidates(tx);
  if (whirlpool) {
    findings.push(buildWhirlpoolFinding(whirlpool.pool, tx.status?.block_time));
    return { findings };
  }

  // Wasabi 1.x: base denomination + near-2x mixing levels
  const wasabi1 = singleOwner ? null : detectWasabi1(spendableOutputs);
  if (wasabi1) {
    findings.push(buildWasabi1Finding(wasabi1, tx.vin.length, spendableOutputs.length));
    findings.push(buildExchangeFlaggingFinding());
    return { findings };
  }

  // WabiSabi (Wasabi 2.x): protocol structure + standard denominations, see wabisabi.ts
  const wabiSabi = singleOwner ? null : classifyWabiSabi(tx);
  const equalOutput = singleOwner ? null : detectEqualOutputs(spendableOutputs.map((o) => o.value));

  if (wabiSabi?.isWabiSabi) {
    const { tiers, standardOutputs } = wabiSabi.evidence;
    const finding = equalOutput
      ? buildGenericCoinJoinFinding(equalOutput.count, equalOutput.denomination, equalOutput.total, tx.vin.length, true)
      : buildWabiSabiMultiTierFinding(tx.vin.length, spendableOutputs.length, tiers, standardOutputs);
    findings.push({ ...finding, confidence: wabiSabi.confidence ?? finding.confidence });
    findings.push(buildExchangeFlaggingFinding());
    return { findings };
  }

  if (equalOutput) {
    const { count, denomination, total } = equalOutput;

    const allOutputCounts = countOutputValues(spendableOutputs);
    const denomTiers = [...allOutputCounts.entries()].filter(([, c]) => c >= 2);
    const nonDenomTiers = denomTiers.filter(([v]) => v !== denomination);
    const hasLargeSecondaryTier = nonDenomTiers.some(([, c]) => c >= 3);
    const isDominantSingleDenom = !hasLargeSecondaryTier && (
      denomTiers.length === 1 ||
      (denomTiers.length >= 2 && count >= 2 * nonDenomTiers.reduce((sum, [, c]) => sum + c, 0))
    );

    if (isDominantSingleDenom && count < total) {
      // Large JoinMarket CoinJoin: single denomination + change outputs
      const changeCount = spendableOutputs.filter((o) => o.value !== denomination).length;
      const isChangeless = changeCount === 0;

      const equalAddresses = new Set<string>();
      for (const o of spendableOutputs) {
        if (o.value === denomination && o.scriptpubkey_address) {
          equalAddresses.add(o.scriptpubkey_address);
        }
      }

      findings.push(buildJoinMarketFinding(
        count, denomination, tx.vin.length, total, changeCount, isChangeless,
        equalAddresses.size >= count ? "high" : "medium",
      ));
    } else {
      // Multiple denomination tiers or non-dominant single denom, but not the
      // WabiSabi structure: a CoinJoin of unknown implementation
      findings.push(buildGenericCoinJoinFinding(count, denomination, total, tx.vin.length, false));
    }
  }

  // Stonewall detection
  if (findings.length === 0) {
    const stonewall = detectStonewall(tx.vin, spendableOutputs);
    if (stonewall) {
      findings.push(buildStonewallFinding(stonewall, tx.vin.length, tx.status?.block_time));
    }
  }

  // Simplified Stonewall
  if (findings.length === 0) {
    const simplified = detectSimplifiedStonewall(tx.vin, spendableOutputs);
    if (simplified) {
      findings.push(buildSimplifiedStonewallFinding(simplified.denomination));
    }
  }

  // Small-scale JoinMarket
  if (findings.length === 0) {
    const joinmarket = detectJoinMarket(tx.vin, spendableOutputs);
    if (joinmarket) {
      const takerChangeOutputs = spendableOutputs.filter((o) => o.value !== joinmarket.denomination);
      const takerChangeCount = takerChangeOutputs.length;
      const isChangeless = takerChangeCount === 0;

      findings.push(buildSmallJoinMarketFinding(
        joinmarket, tx.vin.length, spendableOutputs.length, takerChangeCount, isChangeless,
      ));
    }
  }

  // Exchange flagging warning (skip for Stonewall-only - it's steganographic)
  const onlyFindingId = findings.length === 1 ? findings[0]?.id : undefined;
  const isStonewallOnly = onlyFindingId === "h4-stonewall" || onlyFindingId === "h4-simplified-stonewall";
  if (findings.length > 0 && !isStonewallOnly) {
    findings.push(buildExchangeFlaggingFinding());
  }

  return { findings };
};

/** Set of finding IDs that identify CoinJoin transactions. */
const COINJOIN_FINDING_IDS = new Set<FindingId>([
  "h4-whirlpool", "h4-coinjoin", "h4-joinmarket", "h4-stonewall", "h4-simplified-stonewall",
]);

/** Check if a finding indicates a positive CoinJoin detection. */
export function isCoinJoinFinding(f: Finding): boolean {
  return COINJOIN_FINDING_IDS.has(f.id) && f.scoreImpact > 0;
}

/**
 * Lightweight structural CoinJoin check - no Finding allocations.
 *
 * Called in loops across chain analysis (13+ call sites), so it keeps to
 * boolean detector results. Uses the same detector functions and the same
 * early returns as analyzeCoinJoin, so both agree on what is a CoinJoin.
 */
export function isCoinJoinTx(tx: Tx): boolean {
  if (tx.vin.length < 2 || tx.vout.length < 2) return false;
  // A Whirlpool tx0 is a premix: its equal outputs have not been mixed yet
  if (detectTx0(tx)) return false;

  // Whirlpool (unfiltered outputs, see analyzeCoinJoin)
  if (detectWhirlpool(getSpendableOutputs(tx.vout).map((o) => o.value))) return true;

  const { outputs: spendable, singleOwner } = coinJoinCandidates(tx);
  const values = spendable.map((o) => o.value);

  if (!singleOwner && classifyWabiSabi(tx).isWabiSabi) return true;
  const equalOutput = singleOwner ? null : detectEqualOutputs(values);

  // Equal-output / JoinMarket
  if (equalOutput) return true;

  // Stonewall
  if (detectStonewall(tx.vin, spendable)) return true;

  // Simplified Stonewall
  if (detectSimplifiedStonewall(tx.vin, spendable)) return true;

  // Small-scale JoinMarket
  if (detectJoinMarket(tx.vin, spendable)) return true;

  return false;
}
