import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { isOpReturn, isCoinbase, getAddressedOutputs } from "./tx-utils";
import { ROUND_USD_TOLERANCE_DEFAULT, ROUND_USD_TOLERANCE_SELF_HOSTED } from "./round-amount";
import {
  checkAddressTypeMismatch,
  checkRoundAmount,
  checkValueDisparity,
  checkUnnecessaryInput,
  checkRoundFiatAmount,
  checkOptimalChange,
  checkShadowChange,
  checkFreshAddress,
} from "./change-detection-signals";

/**
 * H2: Change Detection
 *
 * Identifies the likely change output using multiple sub-heuristics:
 * 1. Self-send: output address matches an input address (critical)
 * 2. Address type mismatch: change usually matches input address type
 * 3. Round payment: the non-round output is likely change
 * 4. Value disparity: if one output is 100x+ larger, larger is likely change
 * 5. Unnecessary input: if one input alone could fund a payment, extra inputs reveal change
 *
 * When change is identifiable, the payment amount and direction are revealed.
 *
 * Reference: Meiklejohn et al., 2013
 * Impact: -5 to -25
 */
export const analyzeChangeDetection: TxHeuristic = (tx, _rawHex?, ctx?) => {
  const findings: Finding[] = [];

  // Filter out OP_RETURN outputs before analysis (they are data-only, not payments)
  const spendableOutputs = getAddressedOutputs(tx.vout);

  // Skip coinbase
  if (isCoinbase(tx)) return { findings };

  // ── Sweep detection (1-in, 1-out, no change) ─────────────────────
  // Exactly 1 input + 1 output (no OP_RETURN or other extras) = full spend / sweep.
  // Entropy is 0 bits. The link between input and output is 100% deterministic.
  // Note: txs with OP_RETURN + 1 spendable output are data-attachment payments, not sweeps.
  const isSweep = tx.vin.length === 1 && tx.vout.length === 1;
  if (isSweep) {
    const inputAddr = tx.vin[0].prevout?.scriptpubkey_address;
    const outputAddr = spendableOutputs[0].scriptpubkey_address;
    // Skip if it's sending to the same address (consolidation, already caught by self-send)
    if (inputAddr !== outputAddr) {
      findings.push({
        id: "h2-sweep",
        severity: "low",
        confidence: "deterministic",
        title: "Sweep transaction - single UTXO fully spent",
        params: {
          inputAddress: inputAddr ?? "",
          outputAddress: outputAddr ?? "",
        },
        description:
          "This transaction spends a single input entirely to one output (plus fee). " +
          "No coins are consolidated and no change is created. " +
          "This is standard practice for wallet migration, exact-amount payments, or UTXO swaps.",
        recommendation:
          "Sweep transactions are a normal spending pattern. No privacy action needed.",
        scoreImpact: 0,
      });
    }
  }

  // ── Data-attachment payment (1 spendable + OP_RETURN) ──────────
  // A tx with 1 spendable output and OP_RETURN data carrier (e.g. Omni, OpenTimestamps)
  // has a deterministic input-to-output link, similar to a sweep.
  const hasOpReturn = tx.vout.some((o) => isOpReturn(o.scriptpubkey));
  if (!isSweep && spendableOutputs.length === 1 && hasOpReturn && tx.vin.length >= 1) {
    const outputAddr = spendableOutputs[0].scriptpubkey_address;
    const inAddrs = new Set(tx.vin.map((v) => v.prevout?.scriptpubkey_address).filter(Boolean));
    const isSelfData = outputAddr && inAddrs.has(outputAddr);
    if (!isSelfData) {
      findings.push({
        id: "h2-data-payment",
        severity: "medium",
        confidence: "deterministic",
        title: "Data-attachment payment - deterministic link",
        description:
          "This transaction has 1 spendable output plus an OP_RETURN data carrier. " +
          "The link between sender and receiver is fully deterministic.",
        recommendation:
          "When attaching data to a transaction, consider adding a dummy change " +
          "output to create ambiguity about the payment amount.",
        scoreImpact: -5,
      });
    }
  }

  // ── Wallet hop detection (N-in, 1-out, script type upgrade) ──────
  if (spendableOutputs.length === 1 && spendableOutputs[0].scriptpubkey_address) {
    const inputScriptTypes = new Set<string>();
    for (const v of tx.vin) {
      if (v.prevout?.scriptpubkey_type) inputScriptTypes.add(v.prevout.scriptpubkey_type);
    }
    const outputType = spendableOutputs[0].scriptpubkey_type;

    if (inputScriptTypes.size > 0 && !inputScriptTypes.has(outputType)) {
      const isUpgrade =
        (inputScriptTypes.has("p2pkh") && (outputType === "v0_p2wpkh" || outputType === "v1_p2tr")) ||
        (inputScriptTypes.has("p2sh") && (outputType === "v0_p2wpkh" || outputType === "v1_p2tr")) ||
        (inputScriptTypes.has("v0_p2wpkh") && outputType === "v1_p2tr");

      if (isUpgrade) {
        findings.push({
          id: "h2-wallet-hop",
          severity: "low",
          confidence: "high",
          title: "Address type upgrade detected (possible wallet migration)",
          params: {
            fromTypes: [...inputScriptTypes].join(", "),
            toType: outputType,
          },
          description:
            `Input script type${inputScriptTypes.size > 1 ? "s" : ""} (${[...inputScriptTypes].join(", ")}) ` +
            `differ from the output type (${outputType}), suggesting a wallet migration or address ` +
            "type upgrade. This pattern is consistent with moving funds from an older wallet to a newer one.",
          recommendation:
            "Wallet migrations are fine for operational reasons, but the full-sweep pattern " +
            "links all inputs together. Consider using CoinJoin before consolidating to break linkability.",
          scoreImpact: 0,
        });
      }
    }
  }

  // ── Same-address-in-input-and-output detection (deterministic) ─────
  const inputAddresses = new Set<string>();
  for (const vin of tx.vin) {
    if (vin.prevout?.scriptpubkey_address) {
      inputAddresses.add(vin.prevout.scriptpubkey_address);
    }
  }

  if (inputAddresses.size > 0 && spendableOutputs.length > 0) {
    const matchingOutputs = spendableOutputs.filter(
      (out) => inputAddresses.has(out.scriptpubkey_address!),
    );

    if (matchingOutputs.length > 0) {
      const allMatch = matchingOutputs.length === spendableOutputs.length;
      const matchCount = matchingOutputs.length;
      const totalSpendable = spendableOutputs.length;

      const selfSendIndices: number[] = [];
      for (let i = 0; i < tx.vout.length; i++) {
        const addr = tx.vout[i].scriptpubkey_address;
        if (addr && inputAddresses.has(addr)) {
          selfSendIndices.push(i);
        }
      }

      const isConsolidation = allMatch && spendableOutputs.length === 1;
      const impact = isConsolidation ? -15 : allMatch ? -25 : -20;
      const severity = isConsolidation ? "high" as const : "critical" as const;
      const findingId = !allMatch ? "h2-same-address-io" : "h2-self-send";

      findings.push({
        id: findingId,
        severity,
        confidence: "deterministic",
        title: isConsolidation
          ? "Self-transfer to input address (consolidation)"
          : allMatch
            ? "All outputs return to input address"
            : `Same address in input and output - change revealed (${matchCount} of ${totalSpendable} outputs)`,
        params: {
          matchCount,
          totalSpendable,
          allMatch: allMatch ? 1 : 0,
          selfSendIndices: selfSendIndices.join(","),
        },
        description: isConsolidation
          ? "This consolidation sends funds back to an address that was also an input. " +
            "Combined with multiple inputs, this links all input UTXOs together and confirms address ownership."
          : allMatch
            ? "Every spendable output in this transaction goes back to an address that was also an input. " +
              "This creates a trivial on-chain link between all inputs and outputs. " +
              "A chain observer can see this is a self-transfer with no external recipient."
            : `${matchCount} of ${totalSpendable} spendable outputs go back to an address that was also an input. ` +
              "This is a 100% deterministic link - the output to this address is certainly change, " +
              "revealing which other outputs are payments and the exact payment amount.",
        recommendation:
          "Use a wallet that generates a new change address for every transaction (HD wallets). " +
          "Never send change back to the same address. Sparrow, Wasabi, and Bitcoin Core all handle this correctly.",
        scoreImpact: impact,
        remediation: {
          steps: [
            "Switch to a wallet that uses HD (hierarchical deterministic) key generation - it automatically creates a new change address for every transaction.",
            "Never manually set the change address to your sending address.",
            "If your wallet does not support automatic change addresses, consider Sparrow Wallet or Bitcoin Core.",
            "For funds already exposed by this pattern, consider using CoinJoin to break the linkability.",
          ],
          tools: [
            { name: "Sparrow Wallet", url: "https://sparrowwallet.com" },
            { name: "Bitcoin Core", url: "https://bitcoincore.org" },
          ],
          urgency: "immediate",
        },
      });

      // Self-send / same-address-IO subsumes change detection - no further analysis needed
      return { findings };
    }
  }

  // Only applies to transactions with exactly 2 spendable outputs
  if (spendableOutputs.length !== 2) return { findings };

  // Skip if either output has no address
  if (!spendableOutputs[0].scriptpubkey_address || !spendableOutputs[1].scriptpubkey_address) {
    return { findings };
  }

  const signals: string[] = [];
  const changeIndices = new Map<number, number>(); // output index -> weighted vote count

  // ── Per-signal detail capture (for frontend transparency) ───────
  interface SignalDetail { key: string; votedOutput: number; weight: number; }
  const signalDetails: SignalDetail[] = [];

  /** Wraps a check* call, capturing which output was voted and with what weight. */
  function captureSignal(key: string, fn: () => void): void {
    const prevLen = signals.length;
    const prev0 = changeIndices.get(0) ?? 0;
    const prev1 = changeIndices.get(1) ?? 0;
    fn();
    if (signals.length > prevLen) {
      const d0 = (changeIndices.get(0) ?? 0) - prev0;
      const d1 = (changeIndices.get(1) ?? 0) - prev1;
      signalDetails.push({ key, votedOutput: d0 > 0 ? 0 : 1, weight: Math.max(d0, d1) });
    }
  }

  // Sub-heuristic 1: Address type mismatch
  captureSignal("address_type", () =>
    checkAddressTypeMismatch(tx.vin, spendableOutputs, changeIndices, signals));

  // Sub-heuristic 2: Round amount
  captureSignal("round_amount", () =>
    checkRoundAmount(spendableOutputs, changeIndices, signals));

  // Sub-heuristic 3: Value disparity (100x+ difference)
  captureSignal("value_disparity", () =>
    checkValueDisparity(spendableOutputs, changeIndices, signals));

  // Sub-heuristic 4: Unnecessary input (one input could fund payment alone)
  captureSignal("unnecessary_input", () =>
    checkUnnecessaryInput(tx.vin, spendableOutputs, tx.fee, changeIndices, signals));

  // Sub-heuristic 5: Optimal change (one output > 95% of input value)
  captureSignal("optimal_change", () =>
    checkOptimalChange(tx.vin, spendableOutputs, tx.fee, changeIndices, signals));

  // Sub-heuristic 6: Shadow change (one output much smaller than any input)
  captureSignal("shadow_change", () =>
    checkShadowChange(tx.vin, spendableOutputs, changeIndices, signals));

  // Sub-heuristic 7: Round fiat amount (USD + EUR, requires historical price)
  const tol = ctx?.isCustomApi ? ROUND_USD_TOLERANCE_SELF_HOSTED : ROUND_USD_TOLERANCE_DEFAULT;
  if (ctx?.usdPrice) {
    captureSignal("round_usd_amount", () =>
      checkRoundFiatAmount(spendableOutputs, ctx.usdPrice!, "usd", changeIndices, signals, tol));
  }
  if (ctx?.eurPrice) {
    captureSignal("round_eur_amount", () =>
      checkRoundFiatAmount(spendableOutputs, ctx.eurPrice!, "eur", changeIndices, signals, tol));
  }

  // Sub-heuristic 8: Fresh address vs heavily reused address
  if (ctx?.outputTxCounts) {
    captureSignal("fresh_address", () =>
      checkFreshAddress(spendableOutputs, ctx.outputTxCounts!, changeIndices, signals));
  }

  if (signals.length === 0) return { findings };

  // ── Ratio-based confidence (handles disagreement proportionally) ──
  const signals0 = changeIndices.get(0) ?? 0;
  const signals1 = changeIndices.get(1) ?? 0;
  const maxSignals = Math.max(signals0, signals1);
  const totalWeight = signals0 + signals1;
  const majorityRatio = totalWeight > 0 ? maxSignals / totalWeight : 1;
  const hasMinorityDissent = signals0 > 0 && signals1 > 0;

  // Confidence tiers:
  //   high   = 3+ weight with >= 3/4 majority (strong consensus)
  //   medium = 2+ weight with >= 2/3 majority (clear majority)
  //   low    = weak or deadlocked signals
  // Use fractional literals (not decimals) to avoid floating-point rounding issues.
  type Confidence = "high" | "medium" | "low";
  let findingConfidence: Confidence;
  if (maxSignals >= 3 && majorityRatio >= 3 / 4) {
    findingConfidence = "high";
  } else if (maxSignals >= 2 && majorityRatio >= 2 / 3) {
    findingConfidence = "medium";
  } else {
    findingConfidence = "low";
  }

  // ── Signal key extraction (for backward compat with graph viz) ────
  const signalKeys = signalDetails.map((d) => d.key);
  const hasRoundSignal = signalKeys.includes("round_amount")
    || signalKeys.includes("round_usd_amount")
    || signalKeys.includes("round_eur_amount");

  // ── Impact: scales with confidence, round signal boosts ───────────
  let impact: number;
  if (findingConfidence === "high") {
    impact = hasRoundSignal ? -15 : -12;
  } else if (findingConfidence === "medium") {
    impact = hasRoundSignal ? -12 : -10;
  } else {
    impact = -5;
  }

  // ── Identify which output index the heuristic thinks is change ────
  const changeSpendableIdx = signals0 > signals1 ? 0 : signals1 > signals0 ? 1 : -1;
  let changeVoutIdx: number | undefined;
  if (changeSpendableIdx >= 0) {
    let spendableCount = 0;
    for (let i = 0; i < tx.vout.length; i++) {
      const out = tx.vout[i];
      if (out.scriptpubkey_type !== "op_return" && out.scriptpubkey_address && out.value > 0) {
        if (spendableCount === changeSpendableIdx) {
          changeVoutIdx = i;
          break;
        }
        spendableCount++;
      }
    }
  }

  findings.push({
    id: "h2-change-detected",
    severity: findingConfidence === "high" ? "high"
      : findingConfidence === "medium" ? "medium" : "low",
    confidence: findingConfidence,
    title: `Change output likely identifiable (${findingConfidence} confidence)`,
    params: {
      signalCount: signals.length,
      confidence: findingConfidence,
      ...(changeVoutIdx !== undefined ? { changeIndex: changeVoutIdx } : {}),
      signalKeys: signalKeys.join(","),
      signalDetails: JSON.stringify(signalDetails),
      hasMinorityDissent: hasMinorityDissent ? 1 : 0,
      majorityRatio: Math.round(majorityRatio * 100),
      ...(hasMinorityDissent ? { _variant: "dissent" } : {}),
    },
    description:
      `${signals.length} sub-heuristic${signals.length > 1 ? "s" : ""} point to a likely change output: ${signals.join("; ")}. ` +
      (hasMinorityDissent
        ? "Not all signals agree on which output is change, reducing certainty. "
        : signals.length >= 2
          ? "Multiple signals agree, making change identification reliable. "
          : "") +
      "When the change output is known, the exact payment amount and recipient are revealed.",
    recommendation:
      "Use wallets with change output randomization. Avoid round payment amounts. Use the same address type for all outputs to eliminate the address-type-mismatch signal.",
    scoreImpact: impact,
    remediation: {
      steps: [
        "Avoid sending round BTC amounts (e.g., 0.01 BTC) - use exact amounts or add randomness to make both outputs look similar.",
        "Use a wallet that keeps the same address format for all outputs, removing the address-type-mismatch signal.",
        "Use coin control to spend the change output in isolation, avoiding further linkage.",
        "Consider PayJoin V2 for your next payment - it works without needing a server and breaks change analysis.",
      ],
      tools: [
        { name: "Sparrow Wallet", url: "https://sparrowwallet.com" },
        { name: "Bull Bitcoin (PayJoin V2)", url: "https://www.bullbitcoin.com" },
        { name: "Ashigaru (Stowaway)", url: "https://ashigaru.rs" },
      ],
      urgency: "when-convenient",
    },
  });

  return { findings };
};
