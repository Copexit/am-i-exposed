import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { fmtN } from "@/lib/format";

/**
 * PayJoin / Stowaway Detection
 *
 * PayJoin (P2EP / Stowaway) is a collaborative transaction where the receiver
 * contributes one of their own inputs. This breaks change detection heuristics
 * because the "unnecessary input" actually belongs to the receiver, not the sender.
 *
 * Detection signals:
 * - 2+ inputs from different address types or distinct addresses
 * - 2 outputs (payment + change, but which is which is ambiguous)
 * - One input appears to be "unnecessary" for funding the outputs
 * - The transaction looks like a simple payment but has extra inputs
 *
 * The key insight: in a normal payment, all inputs belong to the sender.
 * In PayJoin, one input belongs to the receiver, making the real payment
 * amount different from what chain analysis would assume.
 *
 * Impact: +8 to +12 (positive - improves privacy)
 */
export const analyzePayJoin: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  // PayJoin requires at least 2 inputs and 2 spendable outputs
  if (tx.vin.length < 2) return { findings };

  const spendable = tx.vout.filter(
    (o) => o.scriptpubkey_type !== "op_return" && o.scriptpubkey_address && o.value > 0,
  );
  if (spendable.length !== 2) return { findings };

  // Skip coinbase
  if (tx.vin.some((v) => v.is_coinbase)) return { findings };

  // Collect distinct input addresses and their script types
  const inputsByAddress = new Map<string, { value: number; type: string }[]>();
  for (const v of tx.vin) {
    const addr = v.prevout?.scriptpubkey_address;
    const type = v.prevout?.scriptpubkey_type ?? "";
    const value = v.prevout?.value ?? 0;
    if (!addr) return { findings }; // need full prevout data
    const existing = inputsByAddress.get(addr) ?? [];
    existing.push({ value, type });
    inputsByAddress.set(addr, existing);
  }

  // PayJoin typically has inputs from exactly 2 distinct addresses
  const distinctAddresses = inputsByAddress.size;
  if (distinctAddresses < 2 || distinctAddresses > 4) return { findings };

  // Check if one input group could fund all outputs alone (the "sender")
  // The other input(s) are from the "receiver"
  const groups = [...inputsByAddress.entries()].map(([addr, inputs]) => ({
    addr,
    total: inputs.reduce((s, i) => s + i.value, 0),
    types: new Set(inputs.map((i) => i.type)),
    count: inputs.length,
  }));

  // Sort by total value descending - the largest group is likely the sender
  groups.sort((a, b) => b.total - a.total);

  const senderGroup = groups[0];
  const receiverTotal = groups.slice(1).reduce((s, g) => s + g.total, 0);

  // The receiver's contribution must be meaningful (not dust)
  if (receiverTotal < 10_000) return { findings };

  // In a PayJoin, the sender should be the dominant contributor.
  // The sender's inputs must meet or exceed the receiver's inputs.
  if (senderGroup.total < receiverTotal) return { findings };

  // Try both outputs as the "naive" payment amount. In PayJoin, the receiver
  // contributes an input that inflates their output. The real amount is:
  //   realAmount = probableAmount - receiverContribution
  // This works regardless of whether the inflated output is the smaller or larger one.
  const [v0, v1] = [spendable[0].value, spendable[1].value];
  let probableAmount = 0;
  let realAmountEstimate = 0;

  // Try the smaller output first (common case)
  const smallerVal = Math.min(v0, v1);
  const smallerReal = smallerVal - receiverTotal;
  // Try the larger output (payment is the larger output case)
  const largerVal = Math.max(v0, v1);
  const largerReal = largerVal - receiverTotal;

  if (smallerReal > 0 && smallerReal < smallerVal * 0.95) {
    probableAmount = smallerVal;
    realAmountEstimate = smallerReal;
  } else if (largerReal > 0 && largerReal < largerVal * 0.95) {
    probableAmount = largerVal;
    realAmountEstimate = largerReal;
  } else {
    return { findings };
  }

  // Additional signal: different script types between sender and receiver
  // suggests different wallets (stronger PayJoin signal)
  const senderTypes = senderGroup.types;
  const receiverTypes = new Set(groups.slice(1).flatMap((g) => [...g.types]));
  const hasMixedTypes = ![...receiverTypes].every((t) => senderTypes.has(t));

  // Score: higher impact for mixed script types (stronger evidence)
  const impact = hasMixedTypes ? 12 : 10;

  findings.push({
    id: "h4-payjoin",
    severity: "good",
    confidence: "medium",
    title: "Possible PayJoin / Stowaway detected",
    params: {
      distinctAddresses,
      probableAmount,
      realAmountEstimate,
      receiverContribution: receiverTotal,
      mixedTypes: hasMixedTypes ? 1 : 0,
    },
    description:
      `This transaction has ${tx.vin.length} inputs from ${distinctAddresses} distinct addresses and 2 outputs, ` +
      "consistent with a PayJoin (Stowaway) pattern where the receiver contributes an input. " +
      `A chain analyst would assume a payment of ${fmtN(probableAmount)} sats, ` +
      `but the real amount is likely ~${fmtN(realAmountEstimate)} sats ` +
      `(receiver contributed ${fmtN(receiverTotal)} sats). ` +
      "PayJoin breaks all standard change detection heuristics.",
    recommendation:
      "PayJoin is one of the strongest privacy techniques available. " +
      "It makes the transaction indistinguishable from a regular payment while hiding the real amount. " +
      "Continue using PayJoin-compatible wallets for maximum privacy.",
    scoreImpact: impact,
    remediation: {
      qualifier: hasMixedTypes
        ? "Strong PayJoin signal: inputs use different script types, confirming two different wallets participated."
        : "Possible PayJoin: inputs come from different addresses but use the same script type.",
      steps: [
        "PayJoin transactions are privacy-positive - no corrective action needed.",
        "For future payments, continue using PayJoin-compatible wallets (BTCPay Server, Ashigaru).",
        "The receiver's contribution makes change analysis unreliable, protecting both parties.",
      ],
      tools: [
        { name: "BTCPay Server (PayJoin V1)", url: "https://btcpayserver.org" },
        { name: "Ashigaru (Stowaway)", url: "https://ashigaru.rs" },
      ],
      urgency: "when-convenient" as const,
    },
  });

  return { findings };
};
