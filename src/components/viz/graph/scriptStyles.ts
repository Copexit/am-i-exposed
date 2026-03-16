/**
 * OXT-style visual encoding for Bitcoin script types.
 *
 * Edge color encodes script type, dash pattern encodes script-hash wrapping,
 * and thickness encodes relative BTC amount (logarithmic scale).
 */

import { getSurfaceColors } from "../shared/svgConstants";

// ─── Script type colors ─────────────────────────────────────────

/** Edge color by scriptpubkey_type (OXT conventions). */
export const SCRIPT_TYPE_COLORS: Record<string, string> = {
  // Legacy
  p2pk: "#28d065",          // green
  p2pkh: "#28d065",         // green

  // Native SegWit
  v0_p2wpkh: "#60a5fa",    // light blue
  v0_p2wsh: "#06b6d4",     // teal

  // Taproot
  v1_p2tr: "#a78bfa",      // purple

  // Wrapped (P2SH)
  p2sh: "#f97316",          // orange
  "p2sh-p2wpkh": "#f97316", // orange
  "p2sh-p2wsh": "#f97316",  // orange

  // Multisig
  multisig: "#f97316",      // orange

  // Special
  op_return: "#78716c",     // warm gray (data-only, not a payment)
  nonstandard: "#ec4899",   // pink
  unknown: "#6b7280",       // gray
};

export function getScriptTypeColor(scriptType: string): string {
  return SCRIPT_TYPE_COLORS[scriptType] ?? SCRIPT_TYPE_COLORS.unknown;
}

// ─── Script dash patterns ───────────────────────────────────────

/** Dash array by script type (encodes script-hash wrapping). */
export function getScriptTypeDash(scriptType: string): string | undefined {
  if (scriptType === "p2sh" || scriptType === "p2sh-p2wpkh" || scriptType === "p2sh-p2wsh") {
    return "8 4";            // 1-gap dashed (P2SH wrapping)
  }
  if (scriptType === "v0_p2wsh") {
    return "8 4 4 4";        // 2-gap dash (witness script hash)
  }
  // P2PKH, P2WPKH, P2TR, P2PK: solid (no wrapping)
  return undefined;
}

// ─── Edge thickness ─────────────────────────────────────────────

const MIN_THICKNESS = 1.5;
const MAX_THICKNESS = 8;

/** Calculate edge thickness on a logarithmic scale relative to the max value. */
export function getEdgeThickness(sats: number, maxSats: number): number {
  if (sats <= 0 || maxSats <= 0) return MIN_THICKNESS;
  const normalized = Math.log2(1 + sats) / Math.log2(1 + maxSats);
  return MIN_THICKNESS + normalized * (MAX_THICKNESS - MIN_THICKNESS);
}

// ─── Fingerprint mode node encoding ─────────────────────────────

/** Node border radius by version (encodes tx version). */
export function getLockTimeRx(version: number): number {
  return version >= 2 ? 8 : 0; // rounded = v2, angular = v1
}

/** Node fill color by locktime (fingerprint mode). Theme-aware.
 *  Light = locktime 0 (stands out), dark = locktime != 0 (common/subdued). */
export function getVersionFill(locktime: number): string {
  const s = getSurfaceColors();
  return locktime === 0 ? s.surfaceElevated : s.cardBorder;
}

// ─── Script type legend data ────────────────────────────────────

export const SCRIPT_TYPE_LEGEND: Array<{ type: string; label: string; color: string; dash?: string }> = [
  { type: "p2pkh", label: "P2PKH", color: SCRIPT_TYPE_COLORS.p2pkh },
  { type: "v0_p2wpkh", label: "P2WPKH", color: SCRIPT_TYPE_COLORS.v0_p2wpkh },
  { type: "v1_p2tr", label: "P2TR", color: SCRIPT_TYPE_COLORS.v1_p2tr },
  { type: "p2sh", label: "P2SH", color: SCRIPT_TYPE_COLORS.p2sh, dash: "8 4" },
  { type: "v0_p2wsh", label: "P2WSH", color: SCRIPT_TYPE_COLORS.v0_p2wsh, dash: "8 4 4 4" },
  { type: "op_return", label: "OP_RETURN", color: SCRIPT_TYPE_COLORS.op_return },
];
