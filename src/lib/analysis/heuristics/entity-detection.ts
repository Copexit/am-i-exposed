import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { matchEntitySync, detectEntityBehavior } from "../entity-filter/entity-match";
import { getFilter } from "../entity-filter/filter-loader";
import { isCoinbase } from "./tx-utils";

/**
 * Entity Address Detection
 *
 * Checks all input/output addresses against:
 * 1. OFAC sanctioned list (exact match, zero false positives)
 * 2. Known entity address filter (Bloom filter, 0.1% FPR)
 * 3. Behavioral patterns (exchange batch, mining pool)
 *
 * Entity matches help users understand who they are transacting with
 * and inform downstream analysis (e.g., post-mix to exchange detection).
 *
 * Severity:
 *   - OFAC match: critical (-20)
 *   - Known entity in inputs: medium (-3)
 *   - Known entity in outputs: low (informational, -1)
 *   - Behavioral: low (informational, 0)
 */

export const analyzeEntityDetection: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  // Skip coinbase transactions (mining reward, no entity concern)
  if (isCoinbase(tx)) return { findings };

  // Collect all addresses with their roles (input vs output)
  const inputAddresses = new Set<string>();
  const outputAddresses = new Set<string>();

  for (const vin of tx.vin) {
    const addr = vin.prevout?.scriptpubkey_address;
    if (addr) inputAddresses.add(addr);
  }

  for (const vout of tx.vout) {
    const addr = vout.scriptpubkey_address;
    if (addr) outputAddresses.add(addr);
  }

  // Check each address against entity databases (synchronous - uses already-loaded filter)
  const inputMatches: Array<{ address: string; entityName: string; ofac: boolean; category?: string }> = [];
  const outputMatches: Array<{ address: string; entityName: string; ofac: boolean; category?: string }> = [];

  for (const addr of inputAddresses) {
    const match = matchEntitySync(addr);
    if (match) inputMatches.push(match);
  }

  for (const addr of outputAddresses) {
    const match = matchEntitySync(addr);
    if (match) outputMatches.push(match);
  }

  // OFAC findings (critical - sanctioned addresses)
  const ofacInputs = inputMatches.filter((m) => m.ofac);
  const ofacOutputs = outputMatches.filter((m) => m.ofac);

  if (ofacInputs.length > 0 || ofacOutputs.length > 0) {
    const allOfac = [...ofacInputs, ...ofacOutputs];
    findings.push({
      id: "entity-ofac-match",
      severity: "critical",
      confidence: "deterministic",
      title: `OFAC sanctioned address${allOfac.length > 1 ? "es" : ""} detected`,
      params: {
        matchCount: allOfac.length,
        addresses: allOfac.map((m) => m.address).join(", "),
        side: ofacInputs.length > 0 && ofacOutputs.length > 0 ? "both" : ofacInputs.length > 0 ? "input" : "output",
      },
      description:
        `${allOfac.length} address${allOfac.length > 1 ? "es" : ""} in this transaction ` +
        `appear${allOfac.length === 1 ? "s" : ""} on the OFAC SDN sanctioned list. ` +
        "Interacting with sanctioned addresses may have legal consequences depending on jurisdiction. " +
        `Matched: ${allOfac.map((m) => m.address.slice(0, 12) + "...").join(", ")}`,
      recommendation:
        "Exercise extreme caution. OFAC-sanctioned addresses are associated with entities " +
        "under US Treasury sanctions. Depending on your jurisdiction, interaction with these " +
        "addresses may carry legal risk.",
      scoreImpact: -20,
    });
  }

  // Known entity findings (non-OFAC filter matches)
  const entityInputs = inputMatches.filter((m) => !m.ofac);
  const entityOutputs = outputMatches.filter((m) => !m.ofac);

  if (entityInputs.length > 0) {
    findings.push({
      id: "entity-known-input",
      severity: "medium",
      confidence: "medium",
      title: `Known entity address${entityInputs.length > 1 ? "es" : ""} in inputs`,
      params: {
        matchCount: entityInputs.length,
        addresses: entityInputs.map((m) => m.address).join(", "),
        entityName: entityInputs[0].entityName,
        category: entityInputs[0].category ?? "unknown",
        filterFpr: getFilter()?.meta.fpr ?? 0.001,
      },
      description:
        `${entityInputs.length} input address${entityInputs.length > 1 ? "es" : ""} matched the ` +
        "known entity database (exchanges, services, mining pools). " +
        `Matched: ${entityInputs.map((m) => m.address.slice(0, 12) + "...").join(", ")}. ` +
        "This suggests the sending party may be a known service or entity. " +
        "Note: the entity filter has a 0.1% false positive rate.",
      recommendation:
        "Inputs from known entities (exchanges, services) indicate the source of funds is traceable. " +
        "If privacy is important, avoid receiving funds directly from known entities without " +
        "intermediate steps (CoinJoin, Lightning, or intermediate hops).",
      scoreImpact: -3,
    });
  }

  if (entityOutputs.length > 0) {
    findings.push({
      id: "entity-known-output",
      severity: "low",
      confidence: "medium",
      title: `Known entity address${entityOutputs.length > 1 ? "es" : ""} in outputs`,
      params: {
        matchCount: entityOutputs.length,
        addresses: entityOutputs.map((m) => m.address).join(", "),
        filterFpr: getFilter()?.meta.fpr ?? 0.001,
      },
      description:
        `${entityOutputs.length} output address${entityOutputs.length > 1 ? "es" : ""} matched the ` +
        "known entity database. " +
        `Matched: ${entityOutputs.map((m) => m.address.slice(0, 12) + "...").join(", ")}. ` +
        "This suggests funds are being sent to a known exchange, service, or entity. " +
        "Note: the entity filter has a 0.1% false positive rate.",
      recommendation:
        "Sending to known entities (especially KYC exchanges) creates a link between your " +
        "on-chain activity and your real identity. Consider using P2P platforms (Bisq, RoboSats, " +
        "HodlHodl) or adding intermediate hops before depositing to exchanges.",
      scoreImpact: -1,
    });
  }

  // Behavioral entity detection (no filter needed)
  const behavior = detectEntityBehavior(tx);
  if (behavior && entityInputs.length === 0 && entityOutputs.length === 0) {
    // Only report behavioral if no filter match (avoid double-reporting)
    if (behavior.type === "exchange-batch") {
      findings.push({
        id: "entity-behavior-exchange",
        severity: "low",
        confidence: behavior.confidence,
        title: "Exchange batch withdrawal pattern detected",
        params: { type: behavior.type, confidence: behavior.confidence },
        description:
          "This transaction has few inputs and many outputs with mixed address types, " +
          "consistent with an exchange batch withdrawal. The sending entity is likely " +
          "a centralized exchange processing multiple customer withdrawals.",
        recommendation:
          "If you received funds in this transaction, be aware the sending exchange " +
          "can identify which output is your withdrawal. Consider mixing received funds " +
          "before further on-chain activity.",
        scoreImpact: 0,
      });
    } else if (behavior.type === "darknet-mixing") {
      findings.push({
        id: "entity-behavior-darknet",
        severity: "medium",
        confidence: behavior.confidence,
        title: "Non-standard mixing pattern detected",
        params: { type: behavior.type, confidence: behavior.confidence },
        description:
          "This transaction has multiple equal-value outputs with non-standard denominations " +
          "and legacy script types (P2PKH/P2SH), consistent with older mixing services " +
          "or darknet market tumbling. The equal outputs create ambiguity but the " +
          "non-standard structure may itself be a fingerprint.",
        recommendation:
          "Non-standard mixing patterns may attract additional scrutiny from chain analysis firms. " +
          "For privacy mixing, use established CoinJoin implementations (Whirlpool, WabiSabi) " +
          "that blend in with a larger anonymity set.",
        scoreImpact: -2,
      });
    } else if (behavior.type === "gambling") {
      findings.push({
        id: "entity-behavior-gambling",
        severity: "low",
        confidence: behavior.confidence,
        title: "Gambling/micropayout pattern detected",
        params: { type: behavior.type, confidence: behavior.confidence },
        description:
          "This transaction has many small-value outputs with low total value, " +
          "consistent with gambling site payouts, faucet distributions, or similar " +
          "micro-transaction services.",
        recommendation:
          "Gambling-related transactions are flagged by many chain analysis services. " +
          "If privacy is important, avoid reusing addresses linked to gambling services " +
          "and consider mixing funds before further on-chain activity.",
        scoreImpact: -1,
      });
    }
  }

  return { findings };
};
