import type { MempoolTransaction } from "@/lib/api/types";
import type { EntityMatch } from "./types";
import { getFilter, loadEntityFilter, lookupEntityName, lookupEntityCategory } from "./filter-loader";
import { checkOfac } from "../cex-risk/ofac-check";
import { extractTxAddresses } from "../cex-risk/extract-addresses";
import { getEntity } from "../entities";
import { WHIRLPOOL_DENOMS } from "@/lib/constants";
import { getSpendableOutputs, getValuedOutputs } from "../heuristics/tx-utils";

/**
 * Resolve entity name, category, and OFAC status for an address.
 * Checks the entity metadata DB first, then falls back to the entity index.
 */
function resolveEntity(
  addr: string,
  entity: { name?: string; category?: string; ofac?: boolean } | null | undefined,
): { name: string | null; category: EntityMatch["category"]; ofac: boolean } {
  const name = entity?.name ?? lookupEntityName(addr);
  const rawCategory = entity?.category ?? lookupEntityCategory(addr) ?? "unknown";
  const category = rawCategory as EntityMatch["category"];
  const ofac = entity?.ofac ?? false;
  return { name, category, ofac };
}

/**
 * Check all addresses in a transaction against known entity databases.
 *
 * Priority order:
 * 1. OFAC exact match (zero false positives) - always available
 * 2. Entity filter probabilistic match (0.1% FPR) - when filter is loaded
 *
 * Returns matches sorted by confidence (high first).
 */
export async function matchEntities(
  tx: MempoolTransaction,
): Promise<EntityMatch[]> {
  const matches: EntityMatch[] = [];
  const addresses = extractTxAddresses(tx);

  // Layer 1: OFAC exact match (always available, zero FPR)
  const ofacResult = checkOfac(addresses);
  for (const addr of ofacResult.matchedAddresses) {
    // Try to resolve the actual entity name and category from the entity index/filter
    const resolvedName = lookupEntityName(addr);
    const entity = resolvedName ? getEntity(resolvedName) : null;
    const resolved = resolveEntity(addr, entity);
    matches.push({
      address: addr,
      entityName: resolved.name ?? "OFAC Sanctioned",
      category: resolved.category,
      ofac: true,
      confidence: "high",
    });
  }

  // Layer 2: Entity address filter (when available)
  let filter = getFilter();
  if (!filter) {
    filter = await loadEntityFilter();
  }

  if (filter) {
    for (const addr of addresses) {
      // Skip addresses already matched by OFAC
      if (ofacResult.matchedAddresses.includes(addr)) continue;

      if (filter.has(addr)) {
        const resolvedName = lookupEntityName(addr);
        const entity = resolvedName ? getEntity(resolvedName) : null;
        const resolved = resolveEntity(addr, entity);
        matches.push({
          address: addr,
          entityName: resolved.name ?? "Known Entity",
          category: resolved.category,
          ofac: resolved.ofac,
          confidence: resolvedName ? "high" : "medium",
        });
      }
    }
  }

  return matches;
}

/**
 * Check a single address against entity databases.
 * Synchronous version that only checks already-loaded data (OFAC + filter if loaded).
 */
export function matchEntitySync(address: string): EntityMatch | null {
  // OFAC check (always available)
  const ofacResult = checkOfac([address]);
  if (ofacResult.sanctioned) {
    const resolvedName = lookupEntityName(address);
    const entity = resolvedName ? getEntity(resolvedName) : null;
    const resolved = resolveEntity(address, entity);
    return {
      address,
      entityName: resolved.name ?? "OFAC Sanctioned",
      category: resolved.category,
      ofac: true,
      confidence: "high",
    };
  }

  // Entity filter (only if already loaded)
  const filter = getFilter();
  if (filter?.has(address)) {
    const resolvedName = lookupEntityName(address);
    const entity = resolvedName ? getEntity(resolvedName) : null;
    const resolved = resolveEntity(address, entity);
    return {
      address,
      entityName: resolved.name ?? "Known Entity",
      category: resolved.category,
      ofac: resolved.ofac,
      confidence: resolvedName ? "high" : "medium",
    };
  }

  return null;
}

/**
 * Enhanced entity detection using behavioral patterns.
 *
 * Even without the address filter, some entity types can be inferred
 * from transaction patterns:
 * - Exchange batch withdrawal: 1-2 inputs, 10+ outputs, mixed types
 * - Mining pool payout: coinbase maturity, many small outputs
 * - Gambling: rapid back-and-forth with small amounts
 *
 * When behavioral match + filter match agree: confidence "high"
 * When only behavioral match: confidence "medium"
 */
export function detectEntityBehavior(
  tx: MempoolTransaction,
): { type: string; confidence: "high" | "medium" } | null {
  // Coinbase spend (mining pool payout or miner) - check first to avoid
  // misclassifying coinbase txs with many outputs as exchange-batch
  if (tx.vin.some((v) => v.is_coinbase)) {
    return { type: "mining", confidence: "high" };
  }

  // Exchange batch withdrawal pattern
  const nonCoinbase = tx.vin.filter((v) => !v.is_coinbase);
  if (nonCoinbase.length <= 2 && tx.vout.length >= 10) {
    // Mixed output script types suggest exchange batch
    const scriptTypes = new Set(tx.vout.map((v) => v.scriptpubkey_type));
    if (scriptTypes.size >= 3) {
      return { type: "exchange-batch", confidence: "medium" };
    }
  }

  // Darknet market pattern: CoinJoin-like structure but with non-standard
  // denominations, often P2PKH/P2SH heavy (legacy scripts), and relatively
  // high input/output counts without matching known CoinJoin denominations.
  // Use canonical WHIRLPOOL_DENOMS from constants (imported at top)
  if (tx.vin.length >= 5 && tx.vout.length >= 5) {
    const spendable = getSpendableOutputs(tx.vout);
    const equalGroups = new Map<number, number>();
    for (const o of spendable) equalGroups.set(o.value, (equalGroups.get(o.value) ?? 0) + 1);
    const hasEqualOutputs = [...equalGroups.entries()].some(([, c]) => c >= 3);
    const maxEqualValue = [...equalGroups.entries()]
      .filter(([, c]) => c >= 3)
      .map(([v]) => v)[0] ?? 0;
    const isKnownDenom = WHIRLPOOL_DENOMS.includes(maxEqualValue);
    // Legacy-heavy (P2PKH/P2SH) scripts suggest older mixing services
    const legacyCount = tx.vout.filter(
      (o) => o.scriptpubkey_type === "p2pkh" || o.scriptpubkey_type === "p2sh",
    ).length;
    const legacyRatio = legacyCount / Math.max(1, spendable.length);

    if (hasEqualOutputs && !isKnownDenom && legacyRatio > 0.5) {
      return { type: "darknet-mixing", confidence: "medium" };
    }
  }

  // Gambling pattern: rapid small-value back-and-forth transactions.
  // Few inputs (1-2), very many small outputs (20+), very low average value.
  // Requires strict thresholds to avoid false positives on normal batch payments.
  if (nonCoinbase.length <= 2 && tx.vout.length >= 20) {
    const spendable = getValuedOutputs(tx.vout);
    const totalOut = spendable.reduce((s, o) => s + o.value, 0);
    const avgOut = totalOut / Math.max(1, spendable.length);
    // Very small average output (< 10k sats) with many outputs suggests gambling/faucet
    if (avgOut < 10_000 && spendable.length >= 20 && totalOut < 2_000_000) {
      return { type: "gambling", confidence: "medium" };
    }
  }

  return null;
}
