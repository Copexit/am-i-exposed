import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { parseMultisigFromInput, type MultisigInfo } from "@/lib/bitcoin/multisig";

/** Known HodlHodl fee collection addresses (mainnet). */
const HODLHODL_FEE_ADDRESSES = new Set([
  "bc1qqmmzt02nu4rqxe03se2zqpw63k0khnwq959zxq",
]);

/**
 * H17: Multisig/Escrow Detection
 *
 * Parses wrapped multisig (P2SH/P2WSH/P2SH-P2WSH) inputs to determine
 * M-of-N configuration and detect escrow patterns:
 * - 2-of-2: possible P2P exchange escrow or Lightning channel close
 * - 2-of-3 + known fee address: likely HodlHodl escrow release
 * - 2-of-3 without fee address: generic escrow or cold storage
 * - Other M-of-N: informational, reveals multi-party nature
 *
 * Impact: 0 to -3
 */
export const analyzeMultisigDetection: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  if (tx.vin.some((v) => v.is_coinbase)) return { findings };

  // Parse all inputs for multisig
  const multisigInputs: { index: number; info: MultisigInfo }[] = [];
  for (let i = 0; i < tx.vin.length; i++) {
    const info = parseMultisigFromInput(tx.vin[i]);
    if (info) multisigInputs.push({ index: i, info });
  }

  if (multisigInputs.length === 0) return { findings };

  const spendableOutputs = tx.vout.filter(
    (out) => out.scriptpubkey_type !== "op_return",
  );

  // ── HodlHodl detection (most specific, check first) ─────────────────
  // Pattern: single 2-of-3 multisig input, 2-3 outputs, one to known fee address
  if (
    tx.vin.length === 1 &&
    multisigInputs.length === 1 &&
    multisigInputs[0].info.m === 2 &&
    multisigInputs[0].info.n === 3 &&
    spendableOutputs.length >= 2 &&
    spendableOutputs.length <= 3
  ) {
    const feeOutput = tx.vout.find(
      (o) => o.scriptpubkey_address && HODLHODL_FEE_ADDRESSES.has(o.scriptpubkey_address),
    );

    if (feeOutput) {
      findings.push({
        id: "h17-hodlhodl",
        severity: "high",
        title: "Likely HodlHodl escrow release (2-of-3 multisig)",
        params: {
          m: 2,
          n: 3,
          scriptType: multisigInputs[0].info.scriptType,
          feeAddress: feeOutput.scriptpubkey_address ?? "",
          feeAmount: feeOutput.value,
        },
        description:
          "This transaction matches the HodlHodl P2P exchange pattern: a 2-of-3 multisig input " +
          "with a small fee output to a known HodlHodl fee address. This identifies the transaction " +
          "as a P2P exchange escrow release with high confidence. The multisig structure reveals " +
          "that three parties (buyer, seller, arbitrator) were involved in custody.",
        recommendation:
          "HodlHodl escrow transactions are identifiable on-chain due to the 2-of-3 multisig structure " +
          "and reused fee address. For more private P2P trading, consider protocols that use " +
          "Taproot-based escrow or Lightning-based settlement (e.g., RoboSats).",
        scoreImpact: -3,
        remediation: {
          steps: [
            "The 2-of-3 multisig structure and fee address pattern cannot be undone for this transaction.",
            "For future P2P trades, consider Lightning-based exchanges (RoboSats) which leave no on-chain escrow footprint.",
            "If continuing to use HodlHodl, be aware that the platform's fee address links your trade to other HodlHodl trades.",
            "Use CoinJoin before or after trading to break the link between the escrow and your other UTXOs.",
          ],
          tools: [
            { name: "RoboSats (Lightning P2P)", url: "https://learn.robosats.com" },
            { name: "Sparrow Wallet (Coin Control)", url: "https://sparrowwallet.com" },
          ],
          urgency: "when-convenient",
        },
      });
      return { findings };
    }
  }

  // ── 2-of-3 escrow (no fee address match) ─────────────────────────────
  // Pattern: single 2-of-3 input, 2-3 outputs
  if (
    tx.vin.length === 1 &&
    multisigInputs.length === 1 &&
    multisigInputs[0].info.m === 2 &&
    multisigInputs[0].info.n === 3 &&
    spendableOutputs.length >= 2 &&
    spendableOutputs.length <= 4
  ) {
    findings.push({
      id: "h17-escrow-2of3",
      severity: "medium",
      title: "2-of-3 multisig escrow detected",
      params: {
        m: 2,
        n: 3,
        scriptType: multisigInputs[0].info.scriptType,
      },
      description:
        "This transaction spends from a 2-of-3 multisig input, a pattern consistent with " +
        "P2P exchange escrow (HodlHodl, Bisq), cold storage (Unchained, Casa, Nunchuk), or " +
        "business escrow. The script reveals that three parties share custody.",
      recommendation:
        "If using multisig for cold storage, consider migrating to Taproot-based multisig " +
        "(MuSig2 or FROST) which looks identical to single-sig on-chain, eliminating this fingerprint.",
      scoreImpact: -2,
      remediation: {
        steps: [
          "The 2-of-3 multisig structure is revealed on-chain when the output is spent.",
          "Consider Taproot-based multisig (MuSig2/FROST) for future setups - it is indistinguishable from single-sig.",
          "If using collaborative custody (Unchained, Casa), be aware that the multisig pattern is visible to chain observers.",
        ],
        tools: [
          { name: "Sparrow Wallet (MuSig2)", url: "https://sparrowwallet.com" },
        ],
        urgency: "when-convenient",
      },
    });
    return { findings };
  }

  // ── 2-of-2 escrow detection ──────────────────────────────────────────
  // Pattern: single 2-of-2 multisig input, exactly 2 outputs
  // Could be: P2P exchange payout (Bisq), Lightning channel close, or custom escrow
  if (
    tx.vin.length === 1 &&
    multisigInputs.length === 1 &&
    multisigInputs[0].info.m === 2 &&
    multisigInputs[0].info.n === 2 &&
    spendableOutputs.length === 2
  ) {
    // Gather additional fingerprint signals
    const signals: string[] = [];
    if (tx.version === 1) signals.push("tx version 1 (bitcoinj-style)");
    if (tx.locktime === 0) signals.push("nLockTime = 0");
    if (tx.vin[0].sequence === 0xffffffff) signals.push("nSequence = max (no RBF)");

    // Lightning cooperative closes typically use locktime = block height and nSequence != max
    const likelyLN = tx.locktime > 0 && tx.vin[0].sequence !== 0xffffffff;

    findings.push({
      id: "h17-escrow-2of2",
      severity: "medium",
      title: "2-of-2 multisig escrow detected",
      params: {
        m: 2,
        n: 2,
        scriptType: multisigInputs[0].info.scriptType,
        signals: signals.join("; "),
        likelyLN: likelyLN ? 1 : 0,
      },
      description:
        "This transaction spends from a 2-of-2 multisig input to exactly 2 outputs, " +
        "a pattern consistent with P2P exchange escrow releases (Bisq) or Lightning Network " +
        "cooperative channel closes. " +
        (likelyLN
          ? "The transaction metadata (nLockTime, nSequence) is consistent with a Lightning channel close."
          : signals.length >= 2
            ? "The transaction metadata (" + signals.join(", ") + ") is consistent with a P2P exchange escrow release."
            : "The 2-of-2 structure reveals that two parties had to sign."),
      recommendation:
        "2-of-2 multisig escrow reveals multi-party involvement on-chain. For future P2P trades, " +
        "consider protocols using Taproot MuSig that hides the multisig structure. " +
        "For Lightning, cooperative closes are normal and expected.",
      scoreImpact: -2,
    });
    return { findings };
  }

  // ── Generic multisig (informational) ─────────────────────────────────
  const types = new Map<string, number>();
  for (const { info } of multisigInputs) {
    const key = `${info.m}-of-${info.n}`;
    types.set(key, (types.get(key) ?? 0) + 1);
  }
  const typeList = [...types.entries()]
    .map(([key, count]) => (count > 1 ? `${key} (${count} inputs)` : key))
    .join(", ");

  const first = multisigInputs[0].info;

  findings.push({
    id: "h17-multisig-info",
    severity: "low",
    title: `Wrapped multisig detected: ${typeList}`,
    params: {
      m: first.m,
      n: first.n,
      scriptType: first.scriptType,
      inputCount: multisigInputs.length,
      types: typeList,
    },
    description:
      `This transaction spends from ${multisigInputs.length} wrapped multisig input${multisigInputs.length > 1 ? "s" : ""} (${typeList}). ` +
      "The M-of-N configuration is revealed when the multisig is spent, exposing the multi-party " +
      "nature of the input. This is visible to any chain observer.",
    recommendation:
      "Use Taproot (P2TR) with MuSig2 or FROST for multisig that is indistinguishable from " +
      "single-sig on-chain. This eliminates the multisig fingerprint entirely.",
    scoreImpact: 0,
  });

  return { findings };
};
