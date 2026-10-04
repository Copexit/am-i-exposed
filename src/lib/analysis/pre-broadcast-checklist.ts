/** Pre-broadcast checklist for a local (not yet broadcast) tx: what it reveals and what to check before sending. */
import type { LocalTx } from "@/lib/input/local-tx";
import type { MempoolTransaction } from "@/lib/api/types";
import type { RecommendedFees } from "@/lib/api/mempool";
import type { Finding, ScoringResult } from "@/lib/types";

export type SafetyId = "fee-absurd" | "fee-high" | "fee-low" | "dust" | "rbf-on" | "rbf-off" | "locktime-none" | "reused-output" | "unsigned" | "partial" | "signatures-later";
export interface SafetyItem { id: SafetyId; tone: "bad" | "warn" | "info" | "good"; params?: Record<string, string | number> }
export interface Checklist { reveals: Finding[]; safety: SafetyItem[]; feeRate: number | null }

export const ABSURD_FEE_RATE = 1000;
export const ABSURD_FEE_SHARE = 0.1;
export const DUST_LIMIT = 546;
const MAX_REVEALS = 5;
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function buildChecklist({ local, tx, result, fees, outputTxCounts }: {
  local: LocalTx; tx: MempoolTransaction; result: ScoringResult; fees: RecommendedFees | null; outputTxCounts: Map<string, number> | null;
}): Checklist {
  const reveals = result.findings
    .filter((f) => f.scoreImpact < 0 && f.severity in SEVERITY_RANK)
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 4) - (SEVERITY_RANK[b.severity] ?? 4) || a.scoreImpact - b.scoreImpact)
    .slice(0, MAX_REVEALS);

  const safety: SafetyItem[] = [];
  if (local.status === "unsigned") safety.push({ id: "unsigned", tone: "info" });
  if (local.status === "partial") safety.push({ id: "partial", tone: "info" });
  if (local.status !== "signed") safety.push({ id: "signatures-later", tone: "info" });

  const known = tx.vin.every((v) => v.prevout);
  const vsize = Math.ceil(tx.weight / 4);
  const feeRate = known && vsize > 0 ? tx.fee / vsize : null;
  if (feeRate !== null) {
    const outTotal = tx.vout.reduce((s, o) => s + o.value, 0);
    if (feeRate > ABSURD_FEE_RATE || tx.fee > outTotal * ABSURD_FEE_SHARE) {
      safety.push({ id: "fee-absurd", tone: "bad", params: { rate: Math.round(feeRate), fee: tx.fee } });
    } else if (fees && feeRate > fees.fastestFee * 2) {
      safety.push({ id: "fee-high", tone: "warn", params: { rate: Math.round(feeRate), fastest: fees.fastestFee } });
    } else if (fees && feeRate < fees.economyFee) {
      safety.push({ id: "fee-low", tone: "warn", params: { rate: Math.round(feeRate * 10) / 10, economy: fees.economyFee } });
    }
  }

  const dust = tx.vout.filter((o) => o.scriptpubkey_type !== "op_return" && o.value < DUST_LIMIT).length;
  if (dust > 0) safety.push({ id: "dust", tone: "warn", params: { count: dust } });

  const rbf = tx.vin.some((v) => v.sequence < 0xfffffffe);
  safety.push({ id: rbf ? "rbf-on" : "rbf-off", tone: "info" });
  if (tx.locktime === 0) safety.push({ id: "locktime-none", tone: "info" });

  if (outputTxCounts) {
    const reused = tx.vout.filter((o) => o.scriptpubkey_address && (outputTxCounts.get(o.scriptpubkey_address) ?? 0) > 0).length;
    if (reused > 0) safety.push({ id: "reused-output", tone: "bad", params: { count: reused } });
  }

  return { reveals, safety, feeRate };
}
