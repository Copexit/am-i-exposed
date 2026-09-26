import type { Finding, Severity } from "@/lib/types";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import { countOutputValues, isOpReturnOutput } from "@/lib/analysis/heuristics/tx-utils";

/**
 * Where a displayed fact comes from. "finding": an engine finding (the tag is
 * shown because the engine emitted that finding). "tx": a structural fact read
 * straight from the transaction data (e.g. two outputs share a value).
 */
export type Provenance =
  | { kind: "finding"; findingId: Finding["id"] }
  | { kind: "tx" };

export type IoTagKind =
  | "change" | "self-send" | "dust" | "op-return" | "entity" | "ofac" | "p2p-fee"
  // Structural facts (provenance "tx"):
  | "anon-set" | "co-spent" | "same-parent";

export interface IoTag {
  kind: IoTagKind;
  severity: Severity;
  source: Provenance;
  /** Kind-specific values for labels (entityName, anonSet, confidence, ...). */
  params?: Record<string, string | number>;
}

export interface IoView {
  index: number;
  address: string | null;
  value: number;
  scriptType: string;
  tags: IoTag[];
  /** Outputs only: true/false once outspends are known, null otherwise. */
  spent: boolean | null;
}

export interface TxIoView {
  inputs: IoView[];
  outputs: IoView[];
}

function indexList(raw: string | number | undefined): number[] {
  if (raw === undefined || raw === "") return [];
  return String(raw).split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 0);
}

/** Prefixes of matched addresses as the entity heuristic lists them ("bc1qxy2kgdyg..."). */
function matchedPrefixes(f: Finding | undefined): Set<string> {
  if (!f) return new Set();
  return new Set(
    String(f.params?.addresses ?? "")
      .split(",")
      .map((s) => s.trim().replace(/\.\.\.$/, ""))
      .filter(Boolean),
  );
}

/**
 * Per-input and per-output tags, each backed by the finding that justifies it.
 * Nothing is re-detected here: indices come from finding params, and entity
 * attribution uses the exact addresses the entity heuristic reported.
 *
 * `entityName` resolves a full address to an entity name for display; pass the
 * entity matcher (matchEntitySync) in the app, or omit it to fall back to the
 * name the finding carries.
 */
export function buildTxIoView(
  tx: MempoolTransaction,
  findings: readonly Finding[],
  outspends?: readonly MempoolOutspend[] | null,
  entityName?: (address: string) => string | null,
): TxIoView {
  const inputs: IoView[] = tx.vin.map((vin, index) => ({
    index,
    address: vin.prevout?.scriptpubkey_address ?? null,
    value: vin.prevout?.value ?? 0,
    scriptType: vin.prevout?.scriptpubkey_type ?? "unknown",
    tags: [],
    spent: null,
  }));
  const outputs: IoView[] = tx.vout.map((vout, index) => ({
    index,
    address: vout.scriptpubkey_address ?? null,
    value: vout.value,
    scriptType: vout.scriptpubkey_type,
    tags: [],
    spent: outspends?.[index] ? outspends[index].spent : null,
  }));

  const byId = new Map(findings.map((f) => [f.id as string, f]));
  const tagOut = (i: number, tag: IoTag) => { if (outputs[i]) outputs[i].tags.push(tag); };
  const from = (f: Finding): Provenance => ({ kind: "finding", findingId: f.id });

  const change = byId.get("h2-change-detected");
  if (change && change.params?.changeIndex !== undefined) {
    tagOut(Number(change.params.changeIndex), {
      kind: "change",
      severity: change.severity,
      source: from(change),
      params: {
        // The finding's final confidence (after cross-heuristic corroboration),
        // not the raw signal vote in params.confidence.
        ...(change.confidence !== undefined ? { confidence: change.confidence } : {}),
        ...(change.params.signalCount !== undefined ? { signalCount: change.params.signalCount } : {}),
        ...(change.params.majorityRatio !== undefined ? { majorityRatio: change.params.majorityRatio } : {}),
      },
    });
  }

  for (const id of ["h2-self-send", "h2-same-address-io"]) {
    const f = byId.get(id);
    if (!f) continue;
    for (const i of indexList(f.params?.selfSendIndices)) {
      tagOut(i, { kind: "self-send", severity: f.severity, source: from(f) });
    }
  }

  for (const id of ["dust-attack", "dust-outputs"]) {
    const f = byId.get(id);
    if (!f) continue;
    for (const i of indexList(f.params?.dustIndices)) {
      tagOut(i, { kind: "dust", severity: f.severity, source: from(f) });
    }
  }

  // OP_RETURN: the heuristic emits "h7-op-return" for a single OP_RETURN output,
  // or "h7-op-return-<k>" for the k-th of several (in output order).
  const opReturnIdx = tx.vout.flatMap((o, i) => (isOpReturnOutput(o) ? [i] : []));
  opReturnIdx.forEach((vout, k) => {
    const f = byId.get(opReturnIdx.length > 1 ? `h7-op-return-${k}` : "h7-op-return");
    if (!f) return;
    tagOut(vout, {
      kind: "op-return",
      severity: f.severity,
      source: from(f),
      params: {
        ...(f.params?.decoded !== undefined ? { decoded: f.params.decoded } : {}),
        ...(f.params?.protocol !== undefined ? { protocol: f.params.protocol } : {}),
      },
    });
  });

  // Entities: attribute to exactly the addresses the entity heuristic listed.
  const ofac = byId.get("entity-ofac-match");
  const entityIn = byId.get("entity-known-input");
  const entityOut = byId.get("entity-known-output");
  const ofacPrefixes = matchedPrefixes(ofac);
  const inPrefixes = matchedPrefixes(entityIn);
  const outPrefixes = matchedPrefixes(entityOut);
  const entityTag = (io: IoView, prefixes: Set<string>, f: Finding | undefined, kind: "entity" | "ofac") => {
    if (!f || !io.address || !prefixes.has(io.address.slice(0, 12))) return;
    const name = entityName?.(io.address) ?? (prefixes.size === 1 ? String(f.params?.entityName ?? "") : "");
    io.tags.push({
      kind,
      severity: f.severity,
      source: from(f),
      params: {
        ...(name ? { entityName: name } : {}),
        ...(f.params?.category !== undefined ? { category: f.params.category } : {}),
      },
    });
  };
  for (const io of inputs) {
    entityTag(io, ofacPrefixes, ofac, "ofac");
    entityTag(io, inPrefixes, entityIn, "entity");
  }
  for (const io of outputs) {
    entityTag(io, ofacPrefixes, ofac, "ofac");
    entityTag(io, outPrefixes, entityOut, "entity");
  }

  // P2P escrow fee outputs (HodlHodl, Bisq): the h17 finding names the fee address.
  for (const [id, name] of [["h17-hodlhodl", "HodlHodl"], ["h17-bisq", "Bisq"]] as const) {
    const f = byId.get(id);
    const feeAddress = f?.params?.feeAddress;
    if (!f || typeof feeAddress !== "string") continue;
    for (const io of outputs) {
      if (io.address === feeAddress) io.tags.push({ kind: "p2p-fee", severity: f.severity, source: from(f), params: { entityName: name } });
    }
  }

  // Outputs later spent together in one transaction (post-mix consolidation
  // and similar): read from outspends.
  const byChild = new Map<string, number[]>();
  outspends?.forEach((os, i) => {
    if (os?.spent && os.txid) byChild.set(os.txid, [...(byChild.get(os.txid) ?? []), i]);
  });
  for (const [childTxid, idx] of byChild) {
    if (idx.length < 2) continue;
    for (const i of idx) tagOut(i, { kind: "co-spent", severity: "medium", source: { kind: "tx" }, params: { count: idx.length, childTxid } });
  }

  // Inputs spending outputs of the same parent transaction.
  const byParent = new Map<string, number[]>();
  tx.vin.forEach((vin, i) => { if (vin.txid) byParent.set(vin.txid, [...(byParent.get(vin.txid) ?? []), i]); });
  for (const [parentTxid, idx] of byParent) {
    if (idx.length < 2) continue;
    for (const i of idx) inputs[i]?.tags.push({ kind: "same-parent", severity: "low", source: { kind: "tx" }, params: { count: idx.length, parentTxid } });
  }

  // Anon sets: outputs sharing an exact value (structural fact, not a finding).
  const valued = tx.vout.filter((o) => !isOpReturnOutput(o) && o.value > 0);
  const counts = countOutputValues(valued);
  for (const io of outputs) {
    const n = io.value > 0 && !isOpReturnOutput(tx.vout[io.index]!) ? counts.get(io.value) ?? 0 : 0;
    if (n >= 2) io.tags.push({ kind: "anon-set", severity: "good", source: { kind: "tx" }, params: { anonSet: n } });
  }

  return { inputs, outputs };
}
