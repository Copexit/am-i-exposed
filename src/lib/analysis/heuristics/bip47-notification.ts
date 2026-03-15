import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { fmtN } from "@/lib/format";
import { isCoinbase } from "./tx-utils";

/**
 * BIP47 Notification Transaction Detection
 *
 * Detects BIP47 (PayNym) notification transactions used to establish
 * reusable payment channels between two identities.
 *
 * Pattern:
 * - 1 input (sender's key used for ECDH)
 * - 1 OP_RETURN output with exactly 80 bytes of data (encrypted payment code)
 * - 1 small output to the receiver's notification address (546-1000 sats typically)
 * - 0-1 change output
 *
 * The notification tx creates toxic change that links the sender's identity
 * to the PayNym connection. This change must be frozen immediately.
 *
 * Impact: +3 (positive - indicates use of reusable payment codes)
 */
export const analyzeBip47Notification: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  if (isCoinbase(tx)) return { findings };

  // BIP47 notification tx typically has 1 input (the key used for ECDH)
  // Some implementations allow 2-3 inputs, but 1 is standard
  if (tx.vin.length < 1 || tx.vin.length > 3) return { findings };

  // Look for OP_RETURN output with exactly 80 bytes (160 hex chars) of data
  const opReturnOutputs = tx.vout.filter(
    (o) => o.scriptpubkey_type === "op_return",
  );

  if (opReturnOutputs.length !== 1) return { findings };

  const opReturn = opReturnOutputs[0];
  const dataHex = extractPaymentCodeData(opReturn.scriptpubkey);

  // BIP47 payment code is exactly 80 bytes = 160 hex characters
  if (dataHex.length !== 160) return { findings };

  // Negative check: known non-BIP47 OP_RETURN protocols with 80-byte payloads
  const lowerData = dataHex.toLowerCase();
  if (lowerData.startsWith("6f6d6e69") ||              // Omni Layer ("omni")
      lowerData.startsWith("434e545250525459") ||       // Counterparty ("CNTRPRTY")
      lowerData.startsWith("53504b") ||                 // Stacks ("SPK")
      lowerData.startsWith("567266")) {                 // Veriblock ("Vrf")
    return { findings };
  }

  // The first byte of the payment code data should be 0x01 (version 1)
  // or 0x02 (version 2) after decryption. Since it's encrypted, we can't
  // check this directly, but we can check the overall structure.

  // Spendable outputs (excluding OP_RETURN)
  const spendable = tx.vout.filter(
    (o) => o.scriptpubkey_type !== "op_return" && o.value > 0,
  );

  // Need at least 1 spendable output (notification dust) and at most 3
  // (notification dust + change + possible extra)
  if (spendable.length < 1 || spendable.length > 3) return { findings };

  // Look for a dust-sized output (notification to receiver's address)
  // BIP47 notification sends a small amount to the receiver's notification address
  const notificationOutput = spendable.find((o) => o.value <= 1_000);

  // The change output is everything else
  const changeOutputs = spendable.filter((o) => o !== notificationOutput);
  const hasChange = changeOutputs.length > 0;
  const changeValue = changeOutputs.reduce((sum, o) => sum + o.value, 0);

  findings.push({
    id: "bip47-notification",
    severity: "good",
    confidence: "high",
    title: "BIP47 notification transaction (PayNym)",
    params: {
      hasNotificationDust: notificationOutput ? 1 : 0,
      notificationValue: notificationOutput?.value ?? 0,
      hasToxicChange: hasChange ? 1 : 0,
      toxicChangeValue: hasChange ? changeValue : 0,
    },
    description:
      "This transaction contains an OP_RETURN with an 80-byte payload consistent with a BIP47 notification transaction. " +
      "BIP47 establishes a reusable payment channel between two PayNym identities. " +
      (notificationOutput
        ? `A small notification output of ${notificationOutput.value} sats was sent to the receiver's notification address. `
        : "") +
      (hasChange
        ? `The change output (${fmtN(changeValue)} sats) is toxic - it permanently links the sender's identity to this PayNym connection.`
        : "No change output detected."),
    recommendation:
      "BIP47 reusable payment codes improve privacy for recurring payments. " +
      (hasChange
        ? "CRITICAL: The change from this notification transaction is toxic. " +
          "It permanently links your wallet to the PayNym connection. " +
          "Freeze this change output immediately and never spend it with your other UTXOs. " +
          "Best practice: use only no-KYC UTXOs for notification transactions."
        : "No toxic change to manage."),
    scoreImpact: 3,
    remediation: hasChange
      ? {
          qualifier: `Toxic change: ${fmtN(changeValue)} sats. This output links your wallet to the PayNym connection.`,
          steps: [
            "Immediately freeze the change output in your wallet's coin control.",
            "Never spend this change with post-mix or regular UTXOs.",
            "For future notification txs, use only no-KYC UTXOs as inputs.",
            "Consider spending the toxic change through a CoinJoin cycle.",
          ],
          tools: [
            { name: "Ashigaru (PayNym + Coin Control)", url: "https://ashigaru.rs" },
            { name: "Sparrow Wallet (Coin Control)", url: "https://sparrowwallet.com" },
          ],
          urgency: "immediate" as const,
        }
      : undefined,
  });

  return { findings };
};

/**
 * Extract the data portion after OP_RETURN opcode and push length bytes.
 * Returns the raw hex data payload.
 */
function extractPaymentCodeData(scriptpubkey: string): string {
  // scriptpubkey starts with 6a (OP_RETURN)
  if (!scriptpubkey.startsWith("6a")) return "";

  let offset = 2;
  if (offset >= scriptpubkey.length) return "";

  const pushByte = parseInt(scriptpubkey.slice(offset, offset + 2), 16);
  if (pushByte <= 0x4b) {
    // Direct push: 1-byte length
    offset += 2;
  } else if (pushByte === 0x4c) {
    // OP_PUSHDATA1: length in next byte
    offset += 4;
  } else if (pushByte === 0x4d) {
    // OP_PUSHDATA2: length in next 2 bytes
    offset += 6;
  }

  return scriptpubkey.slice(offset);
}
