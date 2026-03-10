import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import { getFilter, lookupEntityName, lookupEntityCategory } from "../entity-filter/filter-loader";
import { getEntity } from "../entities";
import { analyzeCoinJoin, isCoinJoinFinding } from "../heuristics/coinjoin";
import type { TraceLayer } from "./recursive-trace";

/**
 * Entity Proximity Detection
 *
 * Scans multi-hop trace layers to find known entities (exchanges, mining pools,
 * darknet markets, etc.) near the analyzed transaction. Reports the closest
 * entity found in each direction (backward/forward) with hop distance.
 *
 * Also detects CoinJoin transactions in the ancestry/descendancy, which is
 * a positive privacy signal.
 */

export interface EntityProximityResult {
  findings: Finding[];
  /** Nearest entity found backward (input provenance) */
  nearestBackward: EntityHit | null;
  /** Nearest entity found forward (output destination) */
  nearestForward: EntityHit | null;
  /** CoinJoin detected in backward trace */
  coinJoinInAncestry: boolean;
  /** CoinJoin detected in forward trace */
  coinJoinInDescendancy: boolean;
}

export interface EntityHit {
  entityName: string;
  category: string;
  address: string;
  hops: number;
  txid: string;
  direction: "backward" | "forward";
}

/**
 * Scan trace layers for entity proximity and CoinJoin ancestry.
 */
export function analyzeEntityProximity(
  tx: MempoolTransaction,
  backwardLayers: TraceLayer[],
  forwardLayers: TraceLayer[],
): EntityProximityResult {
  const findings: Finding[] = [];
  const filter = getFilter();

  let nearestBackward: EntityHit | null = null;
  let nearestForward: EntityHit | null = null;
  let coinJoinInAncestry = false;
  let coinJoinInDescendancy = false;

  // Scan backward layers (input provenance)
  for (const layer of backwardLayers) {
    for (const [, layerTx] of layer.txs) {
      // Check for CoinJoin in ancestry
      if (!coinJoinInAncestry) {
        const cjResult = analyzeCoinJoin(layerTx);
        if (cjResult.findings.some(isCoinJoinFinding)) {
          coinJoinInAncestry = true;
        }
      }

      // Check addresses for entity matches
      if (filter && !nearestBackward) {
        const hit = scanTxForEntity(layerTx, layer.depth, "backward", filter);
        if (hit) nearestBackward = hit;
      }
    }
  }

  // Scan forward layers (output destinations)
  for (const layer of forwardLayers) {
    for (const [, layerTx] of layer.txs) {
      // Check for CoinJoin in descendancy
      if (!coinJoinInDescendancy) {
        const cjResult = analyzeCoinJoin(layerTx);
        if (cjResult.findings.some(isCoinJoinFinding)) {
          coinJoinInDescendancy = true;
        }
      }

      // Check addresses for entity matches
      if (filter && !nearestForward) {
        const hit = scanTxForEntity(layerTx, layer.depth, "forward", filter);
        if (hit) nearestForward = hit;
      }
    }
  }

  // Generate findings

  if (nearestBackward) {
    const entity = getEntity(nearestBackward.entityName);
    const isOfac = entity?.ofac ?? false;
    const hops = nearestBackward.hops;
    const severity = isOfac
      ? (hops <= 1 ? "critical" as const : hops <= 2 ? "high" as const : "medium" as const)
      : hops === 1 ? "high" as const
      : hops === 2 ? "medium" as const
      : "low" as const;
    const impact = isOfac
      ? (hops <= 1 ? -10 : hops <= 2 ? -5 : -2)
      : hops === 1 ? -4
      : hops === 2 ? -2
      : -1;

    findings.push({
      id: "chain-entity-proximity-backward",
      severity,
      confidence: "high",
      title: `${hops} hop${hops > 1 ? "s" : ""} from ${nearestBackward.entityName} (${nearestBackward.category})`,
      description:
        `Input funds can be traced ${hops} hop${hops > 1 ? "s" : ""} back to ` +
        `${nearestBackward.entityName}, a known ${nearestBackward.category}. ` +
        (hops === 1
          ? "Direct connection - the entity can trivially link this transaction to its records."
          : `At ${hops} hops, chain analysis firms can still establish the connection ` +
            "through transaction graph traversal.") +
        (isOfac ? " This entity is on the OFAC sanctions list." : ""),
      recommendation: hops <= 2
        ? "Use CoinJoin to break the on-chain trail from known entities before spending. " +
          "Each CoinJoin round adds ambiguity that makes tracing more expensive."
        : "The distance provides some privacy, but determined analysts can still trace through. " +
          "Consider additional mixing if the source entity is privacy-sensitive.",
      scoreImpact: impact,
      params: {
        entityName: nearestBackward.entityName,
        category: nearestBackward.category,
        hops,
        direction: "backward",
        entityTxid: nearestBackward.txid,
        entityAddress: nearestBackward.address,
      },
    });
  }

  if (nearestForward) {
    const entity = getEntity(nearestForward.entityName);
    const isOfac = entity?.ofac ?? false;
    const hops = nearestForward.hops;
    const severity = isOfac
      ? (hops <= 1 ? "critical" as const : hops <= 2 ? "high" as const : "medium" as const)
      : hops === 1 ? "high" as const
      : hops === 2 ? "medium" as const
      : "low" as const;
    const impact = isOfac
      ? (hops <= 1 ? -10 : hops <= 2 ? -5 : -2)
      : hops === 1 ? -4
      : hops === 2 ? -2
      : -1;

    findings.push({
      id: "chain-entity-proximity-forward",
      severity,
      confidence: "high",
      title: `Funds reach ${nearestForward.entityName} in ${hops} hop${hops > 1 ? "s" : ""}`,
      description:
        `Output funds reach ${nearestForward.entityName} (${nearestForward.category}) ` +
        `within ${hops} hop${hops > 1 ? "s" : ""}. ` +
        (hops === 1
          ? "Direct deposit to a known entity - they can see exactly where the funds came from."
          : `The entity can trace backward through ${hops} hops to reach this transaction.`) +
        (isOfac ? " This entity is on the OFAC sanctions list." : ""),
      recommendation: hops === 1
        ? "Add intermediate hops between your transaction and known entities. Use P2P " +
          "platforms (Bisq, RoboSats) instead of KYC services, or route through Lightning."
        : "Consider whether the forward connection to this entity poses a privacy concern. " +
          "Additional intermediate hops or CoinJoin can increase the tracing cost.",
      scoreImpact: impact,
      params: {
        entityName: nearestForward.entityName,
        category: nearestForward.category,
        hops,
        direction: "forward",
        entityTxid: nearestForward.txid,
        entityAddress: nearestForward.address,
      },
    });
  }

  if (coinJoinInAncestry) {
    findings.push({
      id: "chain-coinjoin-ancestry",
      severity: "good",
      confidence: "high",
      title: "CoinJoin detected in transaction ancestry",
      description:
        "A CoinJoin transaction was found in the input provenance chain. " +
        "This breaks deterministic backward tracing, making it significantly harder " +
        "for analysts to establish the original source of funds.",
      recommendation:
        "Good privacy practice. The CoinJoin in the ancestry adds ambiguity to the " +
        "transaction graph. For maximum benefit, ensure post-CoinJoin spending follows " +
        "best practices (no consolidation, fresh addresses).",
      scoreImpact: 5,
      params: { direction: "backward" },
    });
  }

  if (coinJoinInDescendancy) {
    findings.push({
      id: "chain-coinjoin-descendancy",
      severity: "good",
      confidence: "high",
      title: "CoinJoin detected in forward chain",
      description:
        "Funds from this transaction eventually pass through a CoinJoin, " +
        "breaking forward tracing and adding ambiguity about the final destination.",
      recommendation:
        "The downstream CoinJoin provides forward privacy. Note that the link " +
        "between this transaction and the CoinJoin input is still visible.",
      scoreImpact: 3,
      params: { direction: "forward" },
    });
  }

  return { findings, nearestBackward, nearestForward, coinJoinInAncestry, coinJoinInDescendancy };
}

/** Scan a transaction's addresses for entity filter matches */
function scanTxForEntity(
  layerTx: MempoolTransaction,
  depth: number,
  direction: "backward" | "forward",
  filter: { has(addr: string): boolean },
): EntityHit | null {
  // Check input addresses
  for (const vin of layerTx.vin) {
    const addr = vin.prevout?.scriptpubkey_address;
    if (!addr) continue;
    if (filter.has(addr)) {
      // Only report named entities - skip unnamed Bloom filter matches (possible false positives)
      const entityName = lookupEntityName(addr);
      if (!entityName) continue;
      const category = lookupEntityCategory(addr) ?? "exchange";
      return { entityName, category, address: addr, hops: depth, txid: layerTx.txid, direction };
    }
  }

  // Check output addresses
  for (const vout of layerTx.vout) {
    const addr = vout.scriptpubkey_address;
    if (!addr || vout.scriptpubkey_type === "op_return") continue;
    if (filter.has(addr)) {
      const entityName = lookupEntityName(addr);
      if (!entityName) continue;
      const category = lookupEntityCategory(addr) ?? "exchange";
      return { entityName, category, address: addr, hops: depth, txid: layerTx.txid, direction };
    }
  }

  return null;
}
