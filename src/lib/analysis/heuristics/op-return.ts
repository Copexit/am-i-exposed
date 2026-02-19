import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";

/**
 * H7: OP_RETURN Detection
 *
 * OP_RETURN outputs embed arbitrary data permanently in the blockchain.
 * This data is publicly visible forever and may contain protocol markers,
 * messages, timestamps, or other identifying information.
 *
 * Impact: -5 to -8 per output (stacks)
 */
export const analyzeOpReturn: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  const opReturnOutputs = tx.vout.filter(
    (out) => out.scriptpubkey_type === "op_return",
  );

  if (opReturnOutputs.length === 0) return { findings };

  for (let idx = 0; idx < opReturnOutputs.length; idx++) {
    const out = opReturnOutputs[idx];
    const dataHex = extractOpReturnData(out.scriptpubkey);
    const decoded = tryDecodeUtf8(dataHex);
    const protocol = isRunesScript(out.scriptpubkey) ? "Runes" : detectProtocol(dataHex);

    let description =
      "This transaction embeds data permanently in the blockchain via OP_RETURN. " +
      "This data is publicly visible forever.";

    if (protocol) {
      description += ` Detected protocol: ${protocol}.`;
    }

    if (decoded) {
      description += ` Decoded text: "${truncate(decoded, 100)}".`;
    }

    findings.push({
      id: `h7-op-return${opReturnOutputs.length > 1 ? `-${idx}` : ""}`,
      severity: protocol ? "medium" : "low",
      title: protocol
        ? `OP_RETURN: ${protocol} data embedded`
        : "OP_RETURN data embedded in transaction",
      description,
      recommendation:
        "Be aware that OP_RETURN data is permanent and public. Avoid transactions that embed unnecessary metadata if privacy is a concern.",
      scoreImpact: protocol ? -8 : -5,
    });
  }

  return { findings };
};

/** Extract the data portion after the OP_RETURN opcode (0x6a). */
function extractOpReturnData(scriptpubkey: string): string {
  // scriptpubkey starts with 6a (OP_RETURN), followed by pushdata
  if (!scriptpubkey.startsWith("6a")) return "";

  // Skip OP_RETURN (6a) and the pushdata length byte(s)
  let offset = 2;
  if (offset >= scriptpubkey.length) return "";

  const pushByte = parseInt(scriptpubkey.slice(offset, offset + 2), 16);
  if (pushByte <= 0x4b) {
    // Direct push: 1-byte length
    offset += 2;
  } else if (pushByte === 0x4c) {
    // OP_PUSHDATA1
    offset += 4;
  } else if (pushByte === 0x4d) {
    // OP_PUSHDATA2
    offset += 6;
  }

  return scriptpubkey.slice(offset);
}

function tryDecodeUtf8(hex: string): string | null {
  if (!hex || hex.length < 2) return null;
  try {
    const bytes = hex.match(/.{1,2}/g);
    if (!bytes) return null;
    const decoded = bytes
      .map((b) => String.fromCharCode(parseInt(b, 16)))
      .join("");
    // Only return if it looks like readable text
    if (/^[\x20-\x7e\n\r\t]+$/.test(decoded)) return decoded;
    return null;
  } catch {
    return null;
  }
}

function detectProtocol(hex: string): string | null {
  if (!hex) return null;

  // Omni Layer: starts with "6f6d6e69" (ascii "omni")
  if (hex.startsWith("6f6d6e69")) return "Omni Layer";

  // OpenTimestamps: starts with "4f545301" (ascii "OTS\x01")
  if (hex.startsWith("4f545301")) return "OpenTimestamps";

  // Counterparty: starts with "434e545250525459" (ascii "CNTRPRTY")
  if (hex.startsWith("434e545250525459")) return "Counterparty";

  // Veriblock: starts with "56424b" (ascii "VBK")
  if (hex.startsWith("56424b")) return "VeriBlock";

  // Runes: OP_RETURN followed by OP_13 (0x5d)
  // Note: we check the raw data after OP_RETURN extraction
  // The scriptpubkey itself starts with 6a5d for Runes
  return null;
}

/** Check if the full scriptpubkey is a Runes OP_RETURN (6a 5d ...). */
function isRunesScript(scriptpubkey: string): boolean {
  // Runes use OP_RETURN (6a) followed by OP_13 (5d) as the protocol tag
  return scriptpubkey.startsWith("6a5d");
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
}
