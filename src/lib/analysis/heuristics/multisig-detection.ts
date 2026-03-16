import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { parseMultisigFromInput, type MultisigInfo } from "@/lib/bitcoin/multisig";
import { getSpendableOutputs, isCoinbase } from "./tx-utils";

/** Known HodlHodl fee collection addresses (mainnet). */
const HODLHODL_FEE_ADDRESSES = new Set([
  "bc1qqmmzt02nu4rqxe03se2zqpw63k0khnwq959zxq",
]);

/** Known Bisq fee collection addresses (mainnet). */
const BISQ_FEE_ADDRESSES = new Set([
  "bc1qwxsnvnt7724gg02q624q2pknaqjaaj0vff36vr", // taker fee
  "bc1qfy0hw3txwtkr6xrhk965vjkqqcdn5vx2lrt64a", // maker fee
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
/** HodlHodl fee-pattern bounds (combined buyer + seller fee as fraction of input). */
const HODLHODL_FEE_MIN = 0.004; // 0.4%
const HODLHODL_FEE_MAX = 0.012; // 1.2%
const HODLHODL_FEE_ABS_MAX = 100_000; // sats - absolute cap to avoid coincidental ratio matches

export const analyzeMultisigDetection: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  if (isCoinbase(tx)) return { findings };

  // ── Bisq deposit tx detection (before multisig input parsing) ─────
  // Pattern: 2+ inputs, P2WSH/P2SH output + OP_RETURN with 20-byte contract hash
  // The deposit tx inputs are regular P2WPKH (not multisig), so check this first.
  if (tx.vin.length >= 2) {
    const opReturnOutputs = tx.vout.filter((o) => o.scriptpubkey_type === "op_return");
    const nonOpReturnOutputs = tx.vout.filter((o) => o.scriptpubkey_type !== "op_return");

    if (opReturnOutputs.length === 1 && nonOpReturnOutputs.length >= 1 && nonOpReturnOutputs.length <= 2) {
      // Check OP_RETURN data is exactly 20 bytes (SHA256+RIPEMD160 contract hash)
      // scriptpubkey format: "6a14" (OP_RETURN OP_PUSH20) + 40 hex chars = 44 hex total
      const opReturnHex = opReturnOutputs[0].scriptpubkey;
      const hasContractHash = opReturnHex && opReturnHex.startsWith("6a14") && opReturnHex.length === 44;

      // Check for P2WSH or P2SH output (the multisig escrow address)
      const hasMultisigOutput = nonOpReturnOutputs.some(
        (o) => o.scriptpubkey_type === "v0_p2wsh" || o.scriptpubkey_type === "p2sh",
      );

      if (hasContractHash && hasMultisigOutput) {
        findings.push({
          id: "h17-bisq-deposit",
          severity: "high",
          confidence: "high",
          title: "Bisq escrow deposit detected (OP_RETURN contract hash)",
          params: {
            inputCount: tx.vin.length,
            outputCount: tx.vout.length,
            contractHash: opReturnHex.slice(4), // 40 hex chars
          },
          description:
            "This transaction matches the Bisq P2P exchange deposit pattern: multiple inputs " +
            "(from both traders) funding a 2-of-2 multisig escrow address, with a 20-byte " +
            "OP_RETURN contract hash that cryptographically commits both parties to the trade. " +
            "This pattern is highly specific to Bisq and is not used by other common services.",
          recommendation:
            "Bisq deposit transactions are identifiable on-chain due to the OP_RETURN contract " +
            "hash and 2-of-2 multisig output. For more private P2P trading, consider protocols " +
            "that do not leave distinctive on-chain fingerprints.",
          scoreImpact: -3,
          remediation: {
            steps: [
              "The Bisq deposit fingerprint (OP_RETURN + multisig) cannot be undone for this transaction.",
              "Use CoinJoin before funding Bisq trades to reduce linkability to your other UTXOs.",
              "For future trades, consider Lightning-based P2P exchanges (RoboSats) which leave no on-chain escrow footprint.",
            ],
            tools: [
              { name: "RoboSats (Lightning P2P)", url: "https://learn.robosats.com" },
              { name: "Sparrow Wallet (CoinJoin)", url: "https://sparrowwallet.com" },
            ],
            urgency: "when-convenient",
          },
        });
        return { findings };
      }
    }
  }

  // Parse all inputs for multisig
  const multisigInputs: { index: number; info: MultisigInfo }[] = [];
  for (let i = 0; i < tx.vin.length; i++) {
    const info = parseMultisigFromInput(tx.vin[i]);
    if (info) multisigInputs.push({ index: i, info });
  }

  if (multisigInputs.length === 0) return { findings };

  const spendableOutputs = getSpendableOutputs(tx.vout);

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
        confidence: "high",
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

    // ── HodlHodl fee-pattern fallback (no address match) ──────────────
    // Pattern: exactly 2 spendable outputs, smaller is 0.4-1.2% of input (combined buyer+seller fee)
    if (spendableOutputs.length === 2) {
      const inputValue = tx.vin[0].prevout?.value ?? 0;
      if (inputValue > 0) {
        const [smaller, larger] = spendableOutputs[0].value <= spendableOutputs[1].value
          ? [spendableOutputs[0], spendableOutputs[1]]
          : [spendableOutputs[1], spendableOutputs[0]];
        const feeRatio = smaller.value / inputValue;

        if (
          feeRatio >= HODLHODL_FEE_MIN &&
          feeRatio <= HODLHODL_FEE_MAX &&
          smaller.value < HODLHODL_FEE_ABS_MAX &&
          larger.value > smaller.value * 10 // main payment dwarfs the fee
        ) {
          findings.push({
            id: "h17-hodlhodl",
            severity: "high",
            confidence: "medium",
            title: "Likely HodlHodl escrow release (2-of-3 multisig, fee pattern)",
            params: {
              m: 2,
              n: 3,
              scriptType: multisigInputs[0].info.scriptType,
              feeAmount: smaller.value,
              feeRatio: Math.round(feeRatio * 10000) / 100, // percentage with 2 decimals
            },
            description:
              "This transaction matches the HodlHodl P2P exchange pattern: a 2-of-3 multisig input " +
              "releasing to exactly 2 outputs, where the smaller output (" +
              `${(feeRatio * 100).toFixed(2)}% of input) is consistent with HodlHodl's combined ` +
              "buyer+seller platform fee (typically 0.9-1.0%). The 2-of-3 multisig structure " +
              "indicates buyer, seller, and HodlHodl arbitrator shared custody.",
            recommendation:
              "HodlHodl escrow transactions are identifiable on-chain due to the 2-of-3 multisig structure " +
              "and characteristic fee pattern. For more private P2P trading, consider protocols that use " +
              "Taproot-based escrow or Lightning-based settlement (e.g., RoboSats).",
            scoreImpact: -3,
            remediation: {
              steps: [
                "The 2-of-3 multisig structure and fee pattern cannot be undone for this transaction.",
                "For future P2P trades, consider Lightning-based exchanges (RoboSats) which leave no on-chain escrow footprint.",
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
      confidence: "high",
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

  // ── Bisq 2-of-2 escrow detection (specific, check before generic 2-of-2) ──
  // Pattern: 2-of-2 multisig input with output to known Bisq fee address
  if (
    multisigInputs.some((mi) => mi.info.m === 2 && mi.info.n === 2) &&
    spendableOutputs.length >= 2 &&
    spendableOutputs.length <= 3
  ) {
    const feeOutput = tx.vout.find(
      (o) => o.scriptpubkey_address && BISQ_FEE_ADDRESSES.has(o.scriptpubkey_address),
    );

    if (feeOutput) {
      const bisqInput = multisigInputs.find((mi) => mi.info.m === 2 && mi.info.n === 2)!;
      findings.push({
        id: "h17-bisq",
        severity: "high",
        confidence: "high",
        title: "Likely Bisq escrow release (2-of-2 multisig)",
        params: {
          m: 2,
          n: 2,
          scriptType: bisqInput.info.scriptType,
          feeAddress: feeOutput.scriptpubkey_address ?? "",
          feeAmount: feeOutput.value,
        },
        description:
          "This transaction matches the Bisq P2P exchange pattern: a 2-of-2 multisig input " +
          "with an output to a known Bisq fee address. Both buyer and seller deposit collateral " +
          "into the escrow, and this transaction releases the funds upon trade completion. " +
          "The 2-of-2 multisig structure and fee address reveal this as a Bisq trade.",
        recommendation:
          "Bisq escrow transactions are identifiable on-chain due to the 2-of-2 multisig structure " +
          "and reused fee address. Bisq v2 aims to use Taproot-based escrow which would eliminate " +
          "this fingerprint. Use CoinJoin after receiving from Bisq to break the link.",
        scoreImpact: -3,
        remediation: {
          steps: [
            "The 2-of-2 multisig structure and fee address pattern cannot be undone for this transaction.",
            "Use CoinJoin after receiving from Bisq to break the link between the trade and your other UTXOs.",
            "For future trades, consider Lightning-based P2P exchanges (RoboSats) which leave no on-chain escrow footprint.",
            "Bisq v2 is migrating toward Taproot-based escrow which will reduce on-chain fingerprinting.",
          ],
          tools: [
            { name: "RoboSats (Lightning P2P)", url: "https://learn.robosats.com" },
            { name: "Sparrow Wallet (CoinJoin)", url: "https://sparrowwallet.com" },
          ],
          urgency: "when-convenient",
        },
      });
      return { findings };
    }
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

    if (likelyLN) {
      findings.push({
        id: "lightning-channel-legacy",
        severity: "medium",
        confidence: "medium",  // anti-fee-sniping (BIP-339) can produce false positives
        title: "Likely legacy Lightning channel close",
        params: {
          m: 2,
          n: 2,
          scriptType: multisigInputs[0].info.scriptType,
          signals: signals.join("; "),
          likelyLN: 1,
        },
        description:
          "This transaction matches the pattern of a legacy P2WSH Lightning channel close: " +
          "2-of-2 multisig input with nLockTime > 0 and non-max nSequence. " +
          "The 2-of-2 P2WSH multisig funding output is identifiable by chain analysis as a Lightning channel. " +
          "Note: this pattern can also match 2-of-2 multisig spends using anti-fee-sniping (BIP-339).",
        recommendation:
          "Upgrade to Taproot channels (LND simple-taproot-channels, CLN) which use MuSig2 key aggregation. " +
          "Taproot channel opens and cooperative closes are indistinguishable from regular Taproot spends, " +
          "eliminating the Lightning channel fingerprint entirely.",
        scoreImpact: -3,
        remediation: {
          steps: [
            "The legacy P2WSH channel close is already on-chain and cannot be undone.",
            "For future channels, upgrade to Taproot channels (LND simple-taproot-channels).",
            "Taproot channels are indistinguishable from regular single-sig Taproot spends.",
          ],
          tools: [
            { name: "LND (Taproot Channels)", url: "https://lightning.engineering" },
            { name: "CLN (Core Lightning)", url: "https://corelightning.org" },
          ],
          urgency: "when-convenient" as const,
        },
      });
      return { findings };
    }

    // Non-Lightning 2-of-2 escrow
    findings.push({
      id: "h17-escrow-2of2",
      severity: "medium",
      confidence: "high",
      title: "2-of-2 multisig escrow detected",
      params: {
        m: 2,
        n: 2,
        scriptType: multisigInputs[0].info.scriptType,
        signals: signals.join("; "),
        likelyLN: 0,
      },
      description:
        "This transaction spends from a 2-of-2 multisig input to exactly 2 outputs, " +
        "a pattern consistent with P2P exchange escrow releases (Bisq) or custom escrow. " +
        (signals.length >= 2
          ? "The transaction metadata (" + signals.join(", ") + ") is consistent with a P2P exchange escrow release."
          : "The 2-of-2 structure reveals that two parties had to sign."),
      recommendation:
        "2-of-2 multisig escrow reveals multi-party involvement on-chain. For future P2P trades, " +
        "consider protocols using Taproot MuSig that hides the multisig structure.",
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
    confidence: "deterministic",
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
