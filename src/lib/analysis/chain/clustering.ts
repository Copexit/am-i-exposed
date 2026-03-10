import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import { analyzeCoinJoin, isCoinJoinFinding } from "../heuristics/coinjoin";

/**
 * Entity clustering via Common Input Ownership Heuristic (CIOH).
 *
 * All addresses that appear as inputs in the same transaction are assumed
 * to belong to the same entity (with exceptions for CoinJoin/PayJoin).
 * By following this across multiple transactions, we build an address cluster.
 */

export interface ClusterResult {
  findings: Finding[];
  /** All addresses in the cluster (including the seed address) */
  clusterAddresses: Set<string>;
  /** Cluster size risk tier */
  riskTier: ClusterRiskTier;
}

export type ClusterRiskTier =
  | "single"      // 1 address - ideal compartmentalization
  | "small"       // 2-3 addresses - good
  | "typical"     // 4-10 addresses - normal wallet usage
  | "active"      // 11-50 addresses - active wallet or business
  | "service"     // 51-500 addresses - business/service
  | "exchange";   // 500+ addresses - exchange or processor

/**
 * Build an address cluster starting from a seed address.
 *
 * @param seedAddress - Starting address
 * @param txsByAddress - Map of address -> transactions involving that address
 * @param maxDepth - Maximum expansion depth (default 2)
 * @returns ClusterResult with findings and cluster data
 */
export function buildCluster(
  seedAddress: string,
  txsByAddress: Map<string, MempoolTransaction[]>,
  maxDepth = 2,
): ClusterResult {
  const findings: Finding[] = [];
  const cluster = new Set<string>();
  cluster.add(seedAddress);

  // BFS expansion: track which addresses we've already processed
  const processed = new Set<string>();
  let frontier = new Set<string>([seedAddress]);

  for (let depth = 0; depth < maxDepth && frontier.size > 0; depth++) {
    const nextFrontier = new Set<string>();

    for (const addr of frontier) {
      if (processed.has(addr)) continue;
      processed.add(addr);

      const txs = txsByAddress.get(addr);
      if (!txs) continue;

      for (const tx of txs) {
        // Skip CoinJoin transactions - CIOH does not apply
        const cjResult = analyzeCoinJoin(tx);
        if (cjResult.findings.some(isCoinJoinFinding)) continue;

        // Check if this address appears as an input
        const addrIsInput = tx.vin.some(
          (vin) => vin.prevout?.scriptpubkey_address === addr,
        );
        if (!addrIsInput) continue;

        // Collect all co-input addresses (CIOH: same entity)
        for (const vin of tx.vin) {
          const coAddr = vin.prevout?.scriptpubkey_address;
          if (!coAddr || coAddr === addr) continue;
          if (!cluster.has(coAddr)) {
            cluster.add(coAddr);
            nextFrontier.add(coAddr);
          }
        }
      }
    }

    frontier = nextFrontier;
  }

  const riskTier = classifyClusterSize(cluster.size);

  // Generate findings based on cluster size
  if (cluster.size > 1) {
    const { severity, scoreImpact } = clusterSeverity(riskTier);
    findings.push({
      id: "chain-cluster-size",
      severity,
      title: `Address belongs to a cluster of ${cluster.size} addresses`,
      description: clusterDescription(cluster.size, riskTier),
      recommendation: clusterRecommendation(riskTier),
      scoreImpact,
      params: {
        clusterSize: cluster.size,
        riskTier,
        _variant: "clustered",
      },
      confidence: "high",
    });
  } else {
    findings.push({
      id: "chain-cluster-size",
      severity: "good",
      title: "Address is well-compartmentalized",
      description:
        "This address does not share common input ownership evidence with any other " +
        "address across its transaction history. This indicates good UTXO management " +
        "and address compartmentalization.",
      recommendation:
        "Continue this practice. Avoid consolidating UTXOs from different sources " +
        "in the same transaction.",
      scoreImpact: 3,
      params: {
        clusterSize: 1,
        riskTier: "single",
        _variant: "single",
      },
      confidence: "high",
    });
  }

  return { findings, clusterAddresses: cluster, riskTier };
}

/** Classify cluster size into risk tiers */
export function classifyClusterSize(size: number): ClusterRiskTier {
  if (size <= 1) return "single";
  if (size <= 3) return "small";
  if (size <= 10) return "typical";
  if (size <= 50) return "active";
  if (size <= 500) return "service";
  return "exchange";
}

function clusterSeverity(tier: ClusterRiskTier): {
  severity: Finding["severity"];
  scoreImpact: number;
} {
  switch (tier) {
    case "single":
      return { severity: "good", scoreImpact: 3 };
    case "small":
      return { severity: "good", scoreImpact: 1 };
    case "typical":
      return { severity: "low", scoreImpact: -2 };
    case "active":
      return { severity: "medium", scoreImpact: -5 };
    case "service":
      return { severity: "high", scoreImpact: -8 };
    case "exchange":
      return { severity: "critical", scoreImpact: -12 };
  }
}

function clusterDescription(size: number, tier: ClusterRiskTier): string {
  const base =
    `This address shares common input ownership evidence with ${size - 1} other ` +
    "address" + (size > 2 ? "es" : "") + ". ";

  const riskExplanation: Record<ClusterRiskTier, string> = {
    single: "",
    small: "A small cluster suggests good compartmentalization with minimal address linkage.",
    typical:
      "This is typical for a personal wallet with normal address rotation. " +
      "An analyst can link all transactions across these addresses.",
    active:
      "This cluster size suggests an active wallet or small business. " +
      "All addresses are linkable through common input ownership.",
    service:
      "This large cluster is characteristic of a business, service, or exchange hot wallet. " +
      "All addresses in this cluster are publicly linkable.",
    exchange:
      "This massive cluster is characteristic of a major exchange or payment processor. " +
      "The entire transaction history across all addresses is fully traceable.",
  };

  const warning =
    "If any address in this cluster is linked to an identity (e.g., used on a KYC exchange), " +
    "all addresses in the cluster are compromised.";

  return base + riskExplanation[tier] + " " + warning;
}

function clusterRecommendation(tier: ClusterRiskTier): string {
  switch (tier) {
    case "single":
    case "small":
      return (
        "Good compartmentalization. Continue avoiding consolidation of UTXOs from " +
        "different sources in the same transaction."
      );
    case "typical":
      return (
        "Use coin control to avoid co-spending UTXOs from different contexts. " +
        "Label your UTXOs and spend them individually when possible."
      );
    case "active":
    case "service":
    case "exchange":
      return (
        "Consider breaking this cluster by CoinJoining before future spending. " +
        "Each post-CoinJoin UTXO starts a fresh cluster. Never consolidate post-mix UTXOs."
      );
  }
}
