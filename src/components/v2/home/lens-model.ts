import type { Finding, Severity } from "@/lib/types";
import type { MempoolTransaction } from "@/lib/api/types";
import type { ResultViewModel } from "@/lib/view/tx-view-model";
import { buildAnalystReadings, type OutputReading } from "@/components/v2/stage/analyst";

/**
 * Everything the home "analyst lens" explainer draws, derived from the engine
 * result (view model) of a bundled transaction. No value here is invented:
 * each row points at the finding that justifies it.
 */

export type HubRow =
  | { kind: "pool"; denom: string; findingId: string; severity: Severity }
  | { kind: "wallet"; guess: string | null; signal: string; more: number; findingId: string; severity: Severity }
  | { kind: "version"; version: number; findingId: string; severity: Severity }
  | { kind: "locktime"; findingId: string; severity: Severity }
  | { kind: "entropy"; bits: number; interpretations: number | null; findingId: string; severity: Severity };

export interface LensModel {
  outputs: (OutputReading | null)[];
  /** Inputs read as the same owner as the identified change. */
  sendersKnown: boolean;
  blind: boolean;
  /** CIOH was computed but does not apply (CoinJoin context). */
  ciohVoid: string | null;
  hub: HubRow[];
  verdict:
    | { kind: "blind"; anonSet: number; interpretations: number | null }
    | { kind: "change"; paid: number; change: number; agreement: number | null; certain: boolean }
    | { kind: "none" };
}

const num = (v: unknown): number | null => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export function deriveLens(vm: ResultViewModel, tx: MempoolTransaction): LensModel {
  const readings = buildAnalystReadings(vm);
  const by = (id: string): Finding | undefined => vm.all.find((f) => f.id === id);
  const outputs = tx.vout.map((_, i) => readings.outputs.get(i) ?? null);
  const blind = readings.blinded !== null;
  const hub: HubRow[] = [];

  const wp = by("h4-whirlpool");
  if (wp) hub.push({ kind: "pool", denom: String(wp.params?.denom ?? ""), findingId: wp.id, severity: wp.severity });
  const wf = by("h11-wallet-fingerprint");
  if (wf) {
    const signals = String(wf.params?.signals ?? "").split(";").map((s) => s.trim()).filter(Boolean);
    hub.push({
      kind: "wallet",
      guess: vm.walletGuess,
      signal: (signals[0] ?? "").replace(/\s*\(.*\)$/, ""),
      more: Math.max(0, (num(wf.params?.signalCount) ?? signals.length) - 1),
      findingId: wf.id,
      severity: wf.severity,
    });
  }
  const lv = by("h11-legacy-version");
  if (lv) hub.push({ kind: "version", version: tx.version, findingId: lv.id, severity: lv.severity });
  const nl = by("h11-no-locktime");
  if (nl) hub.push({ kind: "locktime", findingId: nl.id, severity: nl.severity });
  const en = by("h5-entropy") ?? by("h5-low-entropy");
  if (en) hub.push({ kind: "entropy", bits: num(en.params?.entropy) ?? 0, interpretations: num(en.params?.interpretations), findingId: en.id, severity: en.severity });

  const cioh = by("h3-cioh");
  const ciohVoid = cioh && cioh.params?.context === "coinjoin" ? cioh.id : null;

  let verdict: LensModel["verdict"] = { kind: "none" };
  const changeIdx = outputs.findIndex((r) => r?.kind === "change" || r?.kind === "self-send");
  const payIdx = outputs.findIndex((r) => r?.kind === "payment");
  if (blind) {
    const anon = outputs.find((r) => r?.kind === "blinded");
    verdict = {
      kind: "blind",
      anonSet: anon?.kind === "blinded" ? anon.anonSet : 0,
      interpretations: en?.id === "h5-entropy" ? num(en.params?.interpretations) : null,
    };
  } else if (changeIdx >= 0 && payIdx >= 0) {
    const r = outputs[changeIdx]!;
    verdict = {
      kind: "change",
      paid: tx.vout[payIdx]!.value,
      change: tx.vout[changeIdx]!.value,
      agreement: r.kind === "change" ? r.agreement : null,
      certain: r.kind === "self-send",
    };
  }

  return { outputs, sendersKnown: changeIdx >= 0 && !blind, blind, ciohVoid, hub, verdict };
}
