import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { parseMultisigFromInput, type MultisigInfo } from "@/lib/bitcoin/multisig";
import { getSpendableOutputs, isCoinbase } from "./tx-utils";
import {
  buildBisqDepositFinding,
  buildEscrow2of3Finding,
  buildBisqEscrowFinding,
  buildLightningChannelFinding,
  buildEscrow2of2Finding,
  buildGenericMultisigFinding,
} from "./multisig-findings";
import { analyzeHodlHodlDetection } from "./hodlhodl-detection";

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
export const analyzeMultisigDetection: TxHeuristic = (tx, rawHex, ctx) => {
  const findings: Finding[] = [];

  if (isCoinbase(tx)) return { findings };

  const hh = analyzeHodlHodlDetection(tx, rawHex, ctx);
  if (hh.findings.length > 0) return hh;

  // ── Bisq deposit tx detection (before multisig input parsing) ─────
  if (tx.vin.length >= 2) {
    const opReturnOutputs = tx.vout.filter((o) => o.scriptpubkey_type === "op_return");
    const nonOpReturnOutputs = tx.vout.filter((o) => o.scriptpubkey_type !== "op_return");

    if (opReturnOutputs.length === 1 && nonOpReturnOutputs.length >= 1 && nonOpReturnOutputs.length <= 2) {
      const opReturnHex = opReturnOutputs[0].scriptpubkey;
      const hasContractHash = opReturnHex && opReturnHex.startsWith("6a14") && opReturnHex.length === 44;
      const hasMultisigOutput = nonOpReturnOutputs.some(
        (o) => o.scriptpubkey_type === "v0_p2wsh" || o.scriptpubkey_type === "p2sh",
      );

      if (hasContractHash && hasMultisigOutput) {
        findings.push(buildBisqDepositFinding(tx.vin.length, tx.vout.length, opReturnHex.slice(4)));
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

  // ── 2-of-3 escrow (no fee address match) ─────────────────────────────
  if (
    tx.vin.length === 1 &&
    multisigInputs.length === 1 &&
    multisigInputs[0].info.m === 2 &&
    multisigInputs[0].info.n === 3 &&
    spendableOutputs.length >= 2 &&
    spendableOutputs.length <= 4
  ) {
    findings.push(buildEscrow2of3Finding(multisigInputs[0].info.scriptType));
    return { findings };
  }

  // ── Bisq 2-of-2 escrow detection (specific, check before generic 2-of-2) ──
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
      findings.push(buildBisqEscrowFinding(
        bisqInput.info.scriptType,
        feeOutput.scriptpubkey_address ?? "",
        feeOutput.value,
      ));
      return { findings };
    }
  }

  // ── 2-of-2 escrow detection ──────────────────────────────────────────
  if (
    tx.vin.length === 1 &&
    multisigInputs.length === 1 &&
    multisigInputs[0].info.m === 2 &&
    multisigInputs[0].info.n === 2 &&
    spendableOutputs.length === 2
  ) {
    const signals: string[] = [];
    if (tx.version === 1) signals.push("tx version 1 (bitcoinj-style)");
    if (tx.locktime === 0) signals.push("nLockTime = 0");
    if (tx.vin[0].sequence === 0xffffffff) signals.push("nSequence = max (no RBF)");

    const likelyLN = tx.locktime > 0 && tx.vin[0].sequence !== 0xffffffff;

    if (likelyLN) {
      findings.push(buildLightningChannelFinding(multisigInputs[0].info.scriptType, signals));
      return { findings };
    }

    findings.push(buildEscrow2of2Finding(multisigInputs[0].info.scriptType, signals));
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

  findings.push(buildGenericMultisigFinding(first, multisigInputs.length, typeList));

  return { findings };
};
