import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import type { MempoolVin, MempoolVout } from "@/lib/api/types";
import { getAddressType } from "@/lib/bitcoin/address-type";
import { isRoundAmount, isRoundUsdAmount, isRoundEurAmount, ROUND_USD_TOLERANCE_DEFAULT, ROUND_USD_TOLERANCE_SELF_HOSTED } from "./round-amount";
import { isCoinbase, getAddressedOutputs } from "./tx-utils";

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
      // Sweep = 1-in, 1-out. No consolidation (single input), no change output.
      // This is good practice for: wallet migration (UTXO to UTXO), exact-amount
      // payments without change, selling/swapping a complete UTXO.
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
  const hasOpReturn = tx.vout.some((o) => o.scriptpubkey.startsWith("6a"));
  if (!isSweep && spendableOutputs.length === 1 && hasOpReturn && tx.vin.length >= 1) {
    // Check if the single output goes back to an input address (self-send with data)
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
  // Full sweep to a NEW address with a different (upgraded) script type
  // suggests a wallet migration. Informational only (0 impact).
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
  // When the exact same address appears in both inputs and outputs, the change
  // output is 100% identifiable. This is the strongest possible change signal.
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

      // Map matching outputs to their vout indices for the diagram
      const selfSendIndices: number[] = [];
      for (let i = 0; i < tx.vout.length; i++) {
        const addr = tx.vout[i].scriptpubkey_address;
        if (addr && inputAddresses.has(addr)) {
          selfSendIndices.push(i);
        }
      }

      // 1-output consolidation to an input address: primarily a CIOH + address reuse issue.
      // H3 and H8 already penalize those aspects. Apply a reduced self-transfer penalty.
      const isConsolidation = allMatch && spendableOutputs.length === 1;
      const impact = isConsolidation ? -15 : allMatch ? -25 : -20;
      const severity = isConsolidation ? "high" as const : "critical" as const;

      // Use h2-same-address-io for partial matches (where change is deterministically revealed)
      // and h2-self-send for all-match / consolidation patterns
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
  // (more complex transactions need graph analysis)
  if (spendableOutputs.length !== 2) return { findings };

  // Skip if either output has no address
  if (!spendableOutputs[0].scriptpubkey_address || !spendableOutputs[1].scriptpubkey_address) {
    return { findings };
  }

  const signals: string[] = [];
  const changeIndices = new Map<number, number>(); // output index -> signal count

  // Sub-heuristic 1: Address type mismatch
  checkAddressTypeMismatch(tx.vin, spendableOutputs, changeIndices, signals);

  // Sub-heuristic 2: Round amount
  checkRoundAmount(spendableOutputs, changeIndices, signals);

  // Sub-heuristic 3: Value disparity (100x+ difference)
  checkValueDisparity(spendableOutputs, changeIndices, signals);

  // Sub-heuristic 4: Unnecessary input (one input could fund payment alone)
  checkUnnecessaryInput(tx.vin, spendableOutputs, tx.fee, changeIndices, signals);

  // Sub-heuristic 5: Optimal change (one output ≈ total input - fee)
  checkOptimalChange(tx.vin, spendableOutputs, tx.fee, changeIndices, signals);

  // Sub-heuristic 6: Shadow change (one output much smaller than any input)
  checkShadowChange(tx.vin, spendableOutputs, changeIndices, signals);

  // Sub-heuristic 7: Round fiat amount (USD + EUR, requires historical price)
  const tol = ctx?.isCustomApi ? ROUND_USD_TOLERANCE_SELF_HOSTED : ROUND_USD_TOLERANCE_DEFAULT;
  if (ctx?.usdPrice) {
    checkRoundFiatAmount(spendableOutputs, ctx.usdPrice, "usd", changeIndices, signals, tol);
  }
  if (ctx?.eurPrice) {
    checkRoundFiatAmount(spendableOutputs, ctx.eurPrice, "eur", changeIndices, signals, tol);
  }

  // Sub-heuristic 8: Fresh address vs reused address (requires pre-fetched tx counts)
  if (ctx?.outputTxCounts) {
    checkFreshAddress(spendableOutputs, ctx.outputTxCounts, changeIndices, signals);
  }

  if (signals.length === 0) return { findings };

  // Check if signals agree on which output is change
  const signals0 = changeIndices.get(0) ?? 0;
  const signals1 = changeIndices.get(1) ?? 0;
  const maxSignals = Math.max(signals0, signals1);

  // Confidence based on agreement, not just signal count
  const confidence = maxSignals >= 2 ? "medium" : "low";

  // Boost impact when a round amount signal confirms change detection
  const signalKeys = signals.map((s) =>
    s.includes("address type") ? "address_type"
      : s.includes("round USD") ? "round_usd_amount"
      : s.includes("round EUR") ? "round_eur_amount"
      : s.includes("round") ? "round_amount"
      : s.includes("disparity") ? "value_disparity"
      : s.includes("unnecessary") ? "unnecessary_input"
      : s.includes("optimal") ? "optimal_change"
      : s.includes("shadow") ? "shadow_change"
      : s.includes("fresh") ? "fresh_address"
      : "unknown",
  );
  const hasRoundSignal = signalKeys.includes("round_amount")
    || signalKeys.includes("round_usd_amount")
    || signalKeys.includes("round_eur_amount");

  const impact = confidence === "medium"
    ? (hasRoundSignal ? -15 : -10)
    : -5;

  // Identify which output index the heuristic thinks is change.
  // Map indices into full tx.vout space (skip OP_RETURN / zero-value outputs).
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
    severity: confidence === "medium" ? "medium" : "low",
    confidence: confidence === "medium" ? "high" : "medium",
    title: `Change output likely identifiable (${confidence} confidence)`,
    params: {
      signalCount: signals.length,
      confidence,
      ...(changeVoutIdx !== undefined ? { changeIndex: changeVoutIdx } : {}),
      signalKeys: signalKeys.join(","),
    },
    description:
      `${signals.length} sub-heuristic${signals.length > 1 ? "s" : ""} point to a likely change output: ${signals.join("; ")}. ` +
      (maxSignals >= 2
        ? "Multiple signals agree, making change identification reliable. "
        : signals.length >= 2
          ? "However, sub-heuristics disagree on which output is change, reducing confidence. "
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


function checkAddressTypeMismatch(
  vin: MempoolVin[],
  vout: MempoolVout[],
  changeIndices: Map<number, number>,
  signals: string[],
) {
  // Collect input address types
  const inputTypes = new Set<string>();
  for (const v of vin) {
    if (v.prevout?.scriptpubkey_address) {
      inputTypes.add(getAddressType(v.prevout.scriptpubkey_address));
    }
  }

  if (inputTypes.size !== 1) return; // Mixed inputs, can't determine

  const inputType = [...inputTypes][0];
  const out0Type = getAddressType(vout[0].scriptpubkey_address!);
  const out1Type = getAddressType(vout[1].scriptpubkey_address!);

  // If one output matches input type and the other doesn't.
  // Weight is 2 because address type mismatch is one of the strongest change
  // detection signals - alone it should produce "medium confidence".
  if (out0Type === inputType && out1Type !== inputType) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 2);
    signals.push("change matches input address type");
  } else if (out1Type === inputType && out0Type !== inputType) {
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 2);
    signals.push("change matches input address type");
  }
}

function checkRoundAmount(
  vout: MempoolVout[],
  changeIndices: Map<number, number>,
  signals: string[],
) {
  const round0 = isRoundAmount(vout[0].value);
  const round1 = isRoundAmount(vout[1].value);

  // If exactly one output is round, the other is likely change
  if (round0 && !round1) {
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 1);
    signals.push("non-round output is likely change");
  } else if (round1 && !round0) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 1);
    signals.push("non-round output is likely change");
  }
}


function checkValueDisparity(
  vout: MempoolVout[],
  changeIndices: Map<number, number>,
  signals: string[],
) {
  const v0 = vout[0].value;
  const v1 = vout[1].value;
  const ratio = Math.max(v0, v1) / Math.min(v0, v1);

  // 100x+ difference: larger output is likely change (sender's remaining funds)
  if (ratio < 100) return;

  if (v0 > v1) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 1);
    signals.push("large value disparity between outputs");
  } else {
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 1);
    signals.push("large value disparity between outputs");
  }
}

function checkUnnecessaryInput(
  vin: MempoolVin[],
  vout: MempoolVout[],
  fee: number,
  changeIndices: Map<number, number>,
  signals: string[],
) {
  // Need multiple inputs for this heuristic
  if (vin.length < 2) return;

  let largestInput = 0;
  for (const v of vin) {
    const val = v.prevout?.value ?? 0;
    if (val > largestInput) largestInput = val;
  }

  // Check if each output could have been funded by the largest input alone
  const out0Fundable = vout[0].value + fee <= largestInput;
  const out1Fundable = vout[1].value + fee <= largestInput;

  // If exactly one output is fundable by a single input, it's likely the payment
  // (the wallet didn't need the extra inputs for that output)
  if (out0Fundable && !out1Fundable) {
    // Output 0 could be paid by one input; output 1 needed extras -> output 1 is change
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 1);
    signals.push("unnecessary inputs suggest change");
  } else if (out1Fundable && !out0Fundable) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 1);
    signals.push("unnecessary inputs suggest change");
  }
}

function checkRoundFiatAmount(
  vout: MempoolVout[],
  fiatPerBtc: number,
  currency: "usd" | "eur",
  changeIndices: Map<number, number>,
  signals: string[],
  tolerancePct: number = ROUND_USD_TOLERANCE_DEFAULT,
) {
  const isRound = currency === "usd" ? isRoundUsdAmount : isRoundEurAmount;
  const round0 = isRound(vout[0].value, fiatPerBtc, tolerancePct);
  const round1 = isRound(vout[1].value, fiatPerBtc, tolerancePct);
  const label = currency.toUpperCase();

  // If exactly one output is a round fiat amount, the other is likely change
  if (round0 && !round1) {
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 1);
    signals.push(`round ${label} amount output is likely payment`);
  } else if (round1 && !round0) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 1);
    signals.push(`round ${label} amount output is likely payment`);
  }
}

/**
 * Sub-heuristic: Optimal change
 *
 * If one output accounts for > 90% of the total input value (minus fee),
 * it is very likely the change output. The sender spent only a small
 * fraction of their input, returning the rest as change.
 */
function checkOptimalChange(
  vin: MempoolVin[],
  vout: MempoolVout[],
  fee: number,
  changeIndices: Map<number, number>,
  signals: string[],
) {
  let totalInput = 0;
  for (const v of vin) {
    totalInput += v.prevout?.value ?? 0;
  }
  if (totalInput === 0) return;

  const totalSpendable = totalInput - fee;
  if (totalSpendable <= 0) return;

  const ratio0 = vout[0].value / totalSpendable;
  const ratio1 = vout[1].value / totalSpendable;

  // One output gets > 90% of input value - it's almost certainly change
  if (ratio0 > 0.9 && ratio1 <= 0.9) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 1);
    signals.push("optimal change: output receives >90% of input value");
  } else if (ratio1 > 0.9 && ratio0 <= 0.9) {
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 1);
    signals.push("optimal change: output receives >90% of input value");
  }
}

/**
 * Sub-heuristic: Shadow change
 *
 * When one output is significantly smaller than the smallest input,
 * it is likely a small change leftover. The sender spent most of their
 * funds and the "shadow" is the tiny remainder.
 */
function checkShadowChange(
  vin: MempoolVin[],
  vout: MempoolVout[],
  changeIndices: Map<number, number>,
  signals: string[],
) {
  // Find smallest input value
  let smallestInput = Infinity;
  for (const v of vin) {
    const val = v.prevout?.value ?? 0;
    if (val > 0 && val < smallestInput) smallestInput = val;
  }
  if (smallestInput === Infinity) return;

  const v0 = vout[0].value;
  const v1 = vout[1].value;

  // If one output is < 10% of the smallest input, it's likely shadow change
  const threshold = smallestInput * 0.1;
  if (v0 < threshold && v1 >= threshold) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 1);
    signals.push("shadow change: output much smaller than smallest input");
  } else if (v1 < threshold && v0 >= threshold) {
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 1);
    signals.push("shadow change: output much smaller than smallest input");
  }
}

/**
 * Sub-heuristic: Fresh address vs reused address
 *
 * Wallets generate fresh (never-seen) addresses for change. If one output
 * goes to a fresh address (0 prior txs) and the other goes to an address
 * that has been seen before, the fresh address is almost certainly change.
 *
 * Reference: Blockchair 100-indicator PDF, category 4
 */
function checkFreshAddress(
  vout: MempoolVout[],
  outputTxCounts: Map<string, number>,
  changeIndices: Map<number, number>,
  signals: string[],
) {
  const addr0 = vout[0].scriptpubkey_address!;
  const addr1 = vout[1].scriptpubkey_address!;
  const count0 = outputTxCounts.get(addr0);
  const count1 = outputTxCounts.get(addr1);

  // Need data for both outputs
  if (count0 === undefined || count1 === undefined) return;

  // "Fresh" means this tx is the only time the address has appeared (tx_count <= 1).
  // The current tx itself may already be counted, so <= 1 is fresh.
  const fresh0 = count0 <= 1;
  const fresh1 = count1 <= 1;

  // If exactly one is fresh and the other is reused, the fresh one is likely change.
  // Weight is 2 because this is a strong change signal.
  if (fresh0 && !fresh1) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 2);
    signals.push("fresh address is likely change (reused address is likely payment)");
  } else if (fresh1 && !fresh0) {
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 2);
    signals.push("fresh address is likely change (reused address is likely payment)");
  }
}
