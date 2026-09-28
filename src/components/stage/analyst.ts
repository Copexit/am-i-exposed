import type { Finding } from "@/lib/types";
import type { ResultViewModel } from "@/lib/view/tx-view-model";
import type { IoView } from "@/lib/view/tx-io";
import { isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";

/**
 * The "Analyst view": what a chain surveillance analyst reads from this
 * transaction. Derived only from the view model (findings + IO tags) and, for
 * link percentages, the real Boltzmann matrix. Nothing is inferred here that
 * the engine did not already conclude.
 */

export type OutputReading =
  | { kind: "payment"; entityName: string | null; findingId: string }
  | { kind: "change"; agreement: number | null; confidence: string | null; findingId: string }
  | { kind: "self-send"; findingId: string }
  | { kind: "blinded"; anonSet: number; findingId: string };

export interface TxReadings {
  /** Per output index. */
  outputs: Map<number, OutputReading>;
  /** CIOH: inputs read as one owner. */
  cluster: { inputCount: number; findingId: string } | null;
  /** `linkable`: the finding has a visible card to open (it is hidden inside CoinJoins). */
  wallet: { name: string; findingId: string; linkable: boolean } | null;
  /** Named entities the entity heuristics attributed to inputs/outputs. */
  entities: { name: string; side: "input" | "output"; ofac: boolean; findingId: string }[];
  /** P2P exchange escrow fee outputs (HodlHodl, Bisq). */
  p2p: { name: string; findingId: string }[];
  /** Groups of outputs later spent together in one child tx. */
  coSpent: { count: number; txid: string }[];
  /** Groups of inputs spending outputs of one parent tx. */
  sameParent: { count: number; txid: string }[];
  /** CoinJoin: outputs blinded within equal-value tiers. */
  blinded: { tiers: { unit: number; count: number }[]; findingId: string } | null;
}

const tagOf = (io: IoView, kind: string) => io.tags.find((t) => t.kind === kind);
const fid = (tag: { source: { kind: string; findingId?: string } } | undefined) =>
  tag?.source.kind === "finding" ? String(tag.source.findingId) : null;

export function buildAnalystReadings(vm: ResultViewModel): TxReadings {
  const outputs = new Map<number, OutputReading>();
  const io = vm.io;
  const visible = new Set(vm.visible.map((f) => f.id as string));
  const find = (pred: (f: Finding) => boolean) => vm.visible.find(pred) ?? null;

  if (io) {
    const changeIo = io.outputs.find((o) => fid(tagOf(o, "change")));
    const changeTag = changeIo ? tagOf(changeIo, "change") : undefined;
    const changeId = fid(changeTag);
    const changeConfident = changeTag?.params?.confidence !== undefined && changeTag.params.confidence !== "low";
    for (const o of io.outputs) {
      const self = fid(tagOf(o, "self-send"));
      const change = fid(tagOf(o, "change"));
      if (change) {
        // Agreement only means something when 2+ signals were compared.
        const ratio = changeTag?.params?.majorityRatio;
        const signals = Number(changeTag?.params?.signalCount ?? 0);
        outputs.set(o.index, {
          kind: "change",
          agreement: ratio !== undefined && signals >= 2 ? Number(ratio) : null,
          confidence: changeTag?.params?.confidence !== undefined ? String(changeTag.params.confidence) : null,
          findingId: change,
        });
      } else if (self) {
        outputs.set(o.index, { kind: "self-send", findingId: self });
      } else if (changeId && changeConfident && o.value > 0 && o.scriptType !== "op_return" && !tagOf(o, "dust")) {
        // Once change is identified with confidence, every other spendable output reads as a likely payment.
        const entity = o.tags.find((t) => t.kind === "entity" || t.kind === "ofac");
        outputs.set(o.index, {
          kind: "payment",
          entityName: entity?.params?.entityName !== undefined ? String(entity.params.entityName) : null,
          findingId: changeId,
        });
      }
    }
  }

  const cj = vm.isCoinJoin ? find(isCoinJoinFinding) : null;
  let blinded: TxReadings["blinded"] = null;
  if (cj && io) {
    const tiers = new Map<number, number>();
    for (const o of io.outputs) {
      const set = tagOf(o, "anon-set");
      if (!set) continue;
      tiers.set(o.value, Number(set.params?.anonSet));
      outputs.set(o.index, { kind: "blinded", anonSet: Number(set.params?.anonSet), findingId: cj.id });
    }
    blinded = {
      tiers: [...tiers.entries()].map(([unit, count]) => ({ unit, count })).sort((a, b) => b.count - a.count || b.unit - a.unit),
      findingId: cj.id,
    };
  }

  // CIOH is hidden in CoinJoin context (visibleFindings), so this only fires when it is a real reading.
  const cioh = visible.has("h3-cioh") ? find((f) => f.id === "h3-cioh") : null;
  // The wallet guess stays meaningful inside a CoinJoin even though its finding is hidden there.
  const wallet = vm.walletGuess ? vm.all.find((f) => f.id === "h11-wallet-fingerprint") ?? null : null;

  const entities: TxReadings["entities"] = [];
  const seenEntity = new Set<string>();
  for (const [side, list] of [["input", io?.inputs ?? []], ["output", io?.outputs ?? []]] as const) {
    for (const o of list) {
      for (const tag of o.tags) {
        const id = fid(tag);
        const name = tag.params?.entityName;
        if ((tag.kind !== "entity" && tag.kind !== "ofac") || !id || name === undefined) continue;
        const k = `${side}:${name}:${tag.kind}`;
        if (seenEntity.has(k)) continue;
        seenEntity.add(k);
        entities.push({ name: String(name), side, ofac: tag.kind === "ofac", findingId: id });
      }
    }
  }

  const groups = (list: readonly IoView[], kind: "co-spent" | "same-parent", key: "childTxid" | "parentTxid") => {
    const m = new Map<string, number>();
    for (const o of list) {
      const tag = tagOf(o, kind);
      if (tag?.params?.[key] !== undefined) m.set(String(tag.params[key]), Number(tag.params.count));
    }
    return [...m.entries()].map(([txid, count]) => ({ count, txid }));
  };
  const p2p: TxReadings["p2p"] = [];
  for (const o of io?.outputs ?? []) {
    const tag = tagOf(o, "p2p-fee");
    const id = fid(tag);
    if (id && tag?.params?.entityName !== undefined) p2p.push({ name: String(tag.params.entityName), findingId: id });
  }

  return {
    outputs,
    entities,
    p2p,
    coSpent: groups(io?.outputs ?? [], "co-spent", "childTxid"),
    sameParent: groups(io?.inputs ?? [], "same-parent", "parentTxid"),
    cluster: cioh && io ? { inputCount: io.inputs.length, findingId: cioh.id } : null,
    wallet: wallet && vm.walletGuess ? { name: vm.walletGuess, findingId: wallet.id, linkable: visible.has(wallet.id) } : null,
    blinded,
  };
}

/** Highest Boltzmann link probability from any input to output `outIdx` (matrix is [out][in], non-OP_RETURN outputs only). */
export function bestLinkProb(getProb: (inIdx: number, outIdx: number) => number, inputCount: number, outIdx: number): number {
  let best = 0;
  for (let i = 0; i < inputCount; i++) best = Math.max(best, getProb(i, outIdx));
  return best;
}
