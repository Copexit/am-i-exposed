import type { AddressHeuristic } from "./types";
import type { Finding } from "@/lib/types";

/**
 * Recurring Payment Pattern Detection
 *
 * Detects when the same sender-receiver pair transacts multiple times.
 * This is a strong deanonymization signal - it reveals an ongoing
 * financial relationship between two parties.
 *
 * Even with CoinJoin, recurring payments to the same address re-link
 * the parties because the destination is known.
 *
 * Impact: -5 to -10 (scales with frequency)
 */
export const analyzeRecurringPayment: AddressHeuristic = (address, _utxos, txs) => {
  const findings: Finding[] = [];

  if (txs.length < 2) return { findings };

  const targetAddr = address.address;

  // Build a map of counterparty -> tx count
  // For each tx, find which addresses sent to or received from the target
  const senderCounts = new Map<string, number>();
  const receiverCounts = new Map<string, number>();

  for (const tx of txs) {
    // Check if target is a receiver (funded by this tx)
    const targetInOutputs = tx.vout.some(
      (o) => o.scriptpubkey_address === targetAddr,
    );

    if (targetInOutputs) {
      // Who sent to us? Collect all input addresses
      for (const vin of tx.vin) {
        if (vin.is_coinbase) continue;
        const senderAddr = vin.prevout?.scriptpubkey_address;
        if (senderAddr && senderAddr !== targetAddr) {
          senderCounts.set(senderAddr, (senderCounts.get(senderAddr) ?? 0) + 1);
        }
      }
    }

    // Check if target is a sender (spent in this tx)
    const targetInInputs = tx.vin.some(
      (v) => !v.is_coinbase && v.prevout?.scriptpubkey_address === targetAddr,
    );

    if (targetInInputs) {
      // Who did we send to? Collect output addresses
      for (const vout of tx.vout) {
        const recvAddr = vout.scriptpubkey_address;
        if (recvAddr && recvAddr !== targetAddr && vout.scriptpubkey_type !== "op_return") {
          receiverCounts.set(recvAddr, (receiverCounts.get(recvAddr) ?? 0) + 1);
        }
      }
    }
  }

  // Find recurring counterparties (2+ transactions)
  const recurringReceive = [...senderCounts.entries()].filter(([, count]) => count >= 2);
  const recurringSend = [...receiverCounts.entries()].filter(([, count]) => count >= 2);

  const totalRecurring = recurringReceive.length + recurringSend.length;
  if (totalRecurring === 0) return { findings };

  // Most frequent counterparty
  const allCounterparties = [...recurringReceive, ...recurringSend];
  allCounterparties.sort((a, b) => b[1] - a[1]);
  const maxFrequency = allCounterparties[0][1];

  // Scale impact: 2-3 repeats = -5, 4-9 = -7, 10+ = -10
  let impact = -5;
  if (maxFrequency >= 10) impact = -10;
  else if (maxFrequency >= 4) impact = -7;

  findings.push({
    id: "recurring-payment-pattern",
    severity: maxFrequency >= 10 ? "critical" : maxFrequency >= 4 ? "high" : "medium",
    confidence: "high",
    title: `Recurring payment pattern: ${totalRecurring} repeated counterpart${totalRecurring > 1 ? "ies" : "y"}`,
    params: {
      recurringCount: totalRecurring,
      maxFrequency,
      receiveRecurring: recurringReceive.length,
      sendRecurring: recurringSend.length,
    },
    description:
      `This address has transacted with ${totalRecurring} counterpart${totalRecurring > 1 ? "ies" : "y"} ` +
      `more than once (most frequent: ${maxFrequency} times). ` +
      "Recurring payments to or from the same address reveal an ongoing financial relationship. " +
      "A chain analyst can identify regular payment patterns (salary, subscriptions, rent) " +
      "and use them to profile the address owner.",
    recommendation:
      "For recurring payments, use different addresses each time. " +
      "BIP47 (PayNym) provides reusable payment codes that generate unique addresses per payment. " +
      "For receiving, provide a fresh address for each invoice. " +
      "Never reuse addresses for repeated transactions with the same counterparty.",
    scoreImpact: impact,
  });

  return { findings };
};
