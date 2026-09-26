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
 * - Wasabi/generic: many equal outputs (3+) with possible coordinator fee
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

  // Wasabi 1.x: base denomination + near-2x mixing levels (checked before
  // WabiSabi, whose tier heuristic would otherwise also match these rounds)
  const wasabi1 = singleOwner ? null : detectWasabi1(spendableOutputs);
  if (wasabi1) {
    findings.push(buildWasabi1Finding(wasabi1, tx.vin.length, spendableOutputs.length));
    findings.push(buildExchangeFlaggingFinding());
    return { findings };
  }

  // WabiSabi: many inputs + many outputs
  const isWabiSabi = !singleOwner && tx.vin.length >= 10 && spendableOutputs.length >= 10;

  const equalOutput = singleOwner ? null : detectEqualOutputs(spendableOutputs.map((o) => o.value));

  // WabiSabi multi-tier detection: no single 5+ denomination, but multiple groups
  if (!equalOutput && isWabiSabi) {
    const counts = countOutputValues(spendableOutputs);
    const groups = [...counts.entries()].filter(([, c]) => c >= 2);
    const totalEqual = groups.reduce((sum, [, c]) => sum + c, 0);

    if (totalEqual >= 10 && groups.length >= 3) {
      findings.push(buildWabiSabiMultiTierFinding(tx.vin.length, spendableOutputs.length, groups.length, totalEqual));
      return { findings };
    }
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
      // Multiple denomination tiers or non-dominant single denom
      const isActualWabiSabi = isWabiSabi && denomTiers.length >= 3;
      findings.push(buildGenericCoinJoinFinding(count, denomination, total, tx.vin.length, isActualWabiSabi));
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

  // WabiSabi multi-tier
  const isWabiSabi = !singleOwner && tx.vin.length >= 10 && spendable.length >= 10;
  const equalOutput = singleOwner ? null : detectEqualOutputs(values);

  if (!equalOutput && isWabiSabi) {
    const counts = countOutputValues(spendable);
    const groups = [...counts.entries()].filter(([, c]) => c >= 2);
    const totalEqual = groups.reduce((sum, [, c]) => sum + c, 0);
    if (totalEqual >= 10 && groups.length >= 3) return true;
  }

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
