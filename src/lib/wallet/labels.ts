/**
 * Wallet labels (BIP329) against a scanned wallet: which records match it,
 * the labeling convention's origin prefixes, the label each coin carries
 * (its own, its address's, or inherited from the coins that funded it), and
 * the labels exported back, with automatic "aie:" labels.
 *
 * Convention (guide, "How to label coins"): `[ORIGIN] who · detail`, with the
 * prefixes [KYC], [noKYC], [CJ], [change]/[cambio], [toxic]/[tóxico],
 * [person]/[persona]. Pure and in memory: nothing is logged, stored or sent.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import { buildWalletGraph, coinClass, isOwn, simplePayments, soloSpends } from "@/lib/analysis/wallet-behavior";
import { changeExposure } from "@/lib/analysis/wallet-heuristics";
import { buildCoinInputs, groupLetters } from "@/lib/analysis/coin-selection";
import { P2PKH_DUST_LIMIT, TOXIC_CHANGE_THRESHOLD } from "@/lib/constants";
import { AUTO_PREFIX, AUTO_SEPARATOR, MAX_LABEL_LENGTH, recordKey, type Bip329Record } from "./bip329";

// ---------- Convention ----------

export type LabelTag = "kyc" | "nokyc" | "cj" | "change" | "toxic" | "person";
export const LABEL_TAGS: readonly LabelTag[] = ["kyc", "nokyc", "cj", "change", "toxic", "person"];
/** Tags that name where coins came from; `change` and `toxic` are states. */
const ORIGIN_TAGS = new Set<LabelTag>(["kyc", "nokyc", "cj", "person"]);

/** Prefix words (lowercase, no accents, no spaces, dashes or underscores), English and Spanish. */
const TAG_WORDS: Record<string, LabelTag> = {
  kyc: "kyc",
  nokyc: "nokyc", nonkyc: "nokyc", sinkyc: "nokyc",
  cj: "cj", coinjoin: "cj",
  change: "change", cambio: "change",
  toxic: "toxic", toxico: "toxic",
  person: "person", persona: "person",
};

export interface ParsedLabel {
  /** Recognized prefixes, in order */
  tags: LabelTag[];
  /** Text before the first "·" after the prefixes (the counterparty) */
  who: string;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s_-]+/g, "");

/** Parse the `[ORIGIN] who · detail` convention. Unknown bracketed words stay in the text. */
export function parseLabel(label: string): ParsedLabel {
  const tags: LabelTag[] = [];
  let rest = label.trimStart();
  for (let m = /^\[([^\]]{1,24})\]\s*/.exec(rest); m; m = /^\[([^\]]{1,24})\]\s*/.exec(rest)) {
    const tag = TAG_WORDS[norm(m[1]!)];
    if (!tag) break;
    if (!tags.includes(tag)) tags.push(tag);
    rest = rest.slice(m[0].length);
  }
  return { tags, who: rest.split("·")[0]!.trim() };
}

/** Origin keys of a parsed label: origin tag plus counterparty, e.g. "kyc:bitstamp". */
function originKeys({ tags, who }: ParsedLabel): string[] {
  return tags.filter((t) => ORIGIN_TAGS.has(t)).map((t) => `${t}:${who.toLowerCase()}`);
}

// ---------- Matching ----------

/** The label a wallet coin carries. */
export interface CoinLabel {
  /** Label text, from the output's own record or else its address's */
  text?: string;
  source?: "output" | "addr";
  /** Tags of the text, plus origin tags inherited from the coins that funded it (rule 4) */
  tags: LabelTag[];
  /** Some tags come from the parent coins, not from this coin's own label */
  inherited: boolean;
  /** Origin keys ("kyc:bitstamp"), own or inherited */
  origins: string[];
  /** spendable: false */
  frozen: boolean;
}

export interface WalletLabels {
  /** Every imported record, kept as read (for export) */
  records: readonly Bip329Record[];
  /** Records that refer to this wallet's transactions, addresses, inputs, outputs or xpub */
  applied: number;
  /** Records that refer to something else */
  unmatched: number;
  tx: ReadonlyMap<string, string>;
  addr: ReadonlyMap<string, string>;
  /** Unspent coins with a label, a tag or a freeze, by "txid:vout" */
  coins: ReadonlyMap<string, CoinLabel>;
  /** Display name of each origin key (the counterparty as first written) */
  originNames: ReadonlyMap<string, string>;
}

/** Match records against the scanned wallet and resolve each unspent coin's label. */
export function matchLabels(records: readonly Bip329Record[], infos: readonly WalletAddressInfo[], xpub?: string): WalletLabels {
  const g = buildWalletGraph(infos);
  const tx = new Map<string, string>();
  const addr = new Map<string, string>();
  const outputs = new Map<string, Bip329Record>();
  let applied = 0;
  for (const r of records) {
    const [txid, idx] = r.ref.split(":");
    const t = txid ? g.txs.get(txid) : undefined;
    const i = Number(idx);
    let ok = false;
    switch (r.type) {
      case "tx": ok = !!t; if (ok && r.label) tx.set(r.ref, r.label); break;
      case "addr": ok = g.own.has(r.ref); if (ok && r.label) addr.set(r.ref, r.label); break;
      case "output": ok = !!t && isOwn(g, t.vout[i]?.scriptpubkey_address); if (ok) outputs.set(r.ref, r); break;
      case "input": ok = !!t && isOwn(g, t.vin[i]?.prevout?.scriptpubkey_address); break;
      case "xpub": ok = r.ref === xpub; break;
      // ponytail: pubkey and spscan records are not matched (no key derivation here); they still round-trip on export.
      default: ok = false;
    }
    if (ok) applied++;
  }

  // Own label first; a coin with no origin tag that the wallet funded inherits its inputs' origins (rule 4).
  const memo = new Map<string, { tags: LabelTag[]; origins: string[] }>();
  const originNames = new Map<string, string>();
  const resolve = (txid: string, vout: number, depth: number): { tags: LabelTag[]; origins: string[] } => {
    const k = `${txid}:${vout}`;
    const hit = memo.get(k);
    if (hit) return hit;
    const fundTx = g.txs.get(txid);
    const text = outputs.get(k)?.label ?? addr.get(fundTx?.vout[vout]?.scriptpubkey_address ?? "");
    const own = text ? parseLabel(text) : { tags: [], who: "" };
    let tags = own.tags, origins = originKeys(own);
    for (const o of origins) if (!originNames.has(o)) originNames.set(o, own.who);
    const cls = coinClass(g, txid, vout);
    if (origins.length === 0 && fundTx && depth < 1000 && (cls === "change" || cls === "self" || cls === "coinjoin-change")) {
      const parents = fundTx.vin.map((v) => resolve(v.txid, v.vout, depth + 1));
      // Change of a [CJ] coin is not mixed: it inherits as toxic (CoinJoin change), never as [CJ].
      const inheritedTags = new Set(parents.flatMap((p) => p.tags
        .filter((t) => ORIGIN_TAGS.has(t) || t === "toxic")
        .map((t): LabelTag => (t === "cj" ? "toxic" : t))));
      origins = [...new Set(parents.flatMap((p) => p.origins.filter((o) => !o.startsWith("cj:"))))];
      tags = [...new Set([...tags, ...inheritedTags])];
    }
    const r = { tags, origins };
    memo.set(k, r);
    return r;
  };

  const coins = new Map<string, CoinLabel>();
  for (const info of infos) {
    for (const u of info.utxos) {
      const k = `${u.txid}:${u.vout}`;
      const rec = outputs.get(k);
      const text = rec?.label ?? addr.get(info.derived.address);
      const { tags, origins } = resolve(u.txid, u.vout, 0);
      const ownTags = text ? parseLabel(text).tags : [];
      const frozen = rec?.spendable === false;
      if (!text && tags.length === 0 && !frozen) continue;
      coins.set(k, {
        text, source: rec?.label ? "output" : text ? "addr" : undefined,
        tags, inherited: tags.some((t) => !ownTags.includes(t)), origins, frozen,
      });
    }
  }
  return { records, applied, unmatched: records.length - applied, tx, addr, coins, originNames };
}

// ---------- Export ----------

/** Automatic labels ("aie: ...") for the wallet's unspent coins, exposed change outputs and reused addresses, by record key. */
export function autoLabels(infos: readonly WalletAddressInfo[]): Map<string, { type: "output" | "addr"; ref: string; label: string }> {
  const out = new Map<string, { type: "output" | "addr"; ref: string; label: string }>();
  const g = buildWalletGraph(infos);
  const exposed = new Set(
    simplePayments(g, soloSpends(g)).filter((p) => changeExposure(p)).map((p) => `${p.tx.txid}:${p.tx.vout.indexOf(p.change)}`),
  );
  const coins = buildCoinInputs([...infos]);
  const { letters } = groupLetters(coins);
  const parts = new Map<string, string[]>();
  for (const c of coins) {
    const k = `${c.utxo.txid}:${c.utxo.vout}`;
    const p: string[] = [];
    const v = c.utxo.value;
    if (c.origin === "mixed") p.push("CoinJoin output");
    else if (c.origin === "coinjoin-change" || ((c.origin === "change" || c.origin === "self") && v >= P2PKH_DUST_LIMIT && v < TOXIC_CHANGE_THRESHOLD)) p.push("toxic change");
    if (exposed.has(k)) p.push("exposed change");
    const l = letters.get(k);
    if (l) p.push(`group ${l.letter}${l.inferred ? " (probable)" : ""}`);
    if (p.length) parts.set(k, p);
  }
  // Exposed change already spent still gets its label, so the history reads right in another wallet.
  for (const k of exposed) if (!parts.has(k)) parts.set(k, ["exposed change"]);
  for (const [k, p] of parts) out.set(`output:${k}`, { type: "output", ref: k, label: AUTO_PREFIX + p.join(", ") });
  for (const info of infos) {
    const d = info.addressData;
    if (d && d.chain_stats.funded_txo_count + d.mempool_stats.funded_txo_count > 1) {
      out.set(`addr:${info.derived.address}`, { type: "addr", ref: info.derived.address, label: `${AUTO_PREFIX}reused address` });
    }
  }
  return out;
}

/**
 * Records to export. The user's records come first and unchanged, except
 * that a record with an automatic label becomes "<user label> | aie: ..."
 * (only when that fits MAX_LABEL_LENGTH: the user's label is never cut).
 * Automatic labels for refs the user did not label follow, with no origin,
 * so any wallet holding the ref applies them. `onlyAuto` exports those alone.
 * Importing the result drops every automatic part (bip329.userPart), so
 * import(export(x)) gives back x.
 */
export function exportRecords(
  records: readonly Bip329Record[],
  auto: ReadonlyMap<string, { type: "output" | "addr"; ref: string; label: string }>,
  onlyAuto = false,
): Bip329Record[] {
  if (onlyAuto) return [...auto.values()].map((a) => ({ ...a }));
  const used = new Set<string>();
  const out = records.map((r) => {
    const a = auto.get(recordKey(r));
    if (!a) return r;
    used.add(recordKey(r));
    if (!r.label) return { ...r, label: a.label };
    const merged = r.label + AUTO_SEPARATOR + a.label;
    return merged.length <= MAX_LABEL_LENGTH ? { ...r, label: merged } : r;
  });
  for (const [k, a] of auto) if (!used.has(k)) out.push({ ...a });
  return out;
}

/** Export filename: a short hash of the xpub (not a BIP32 fingerprint, which a bare xpub does not carry). */
export function labelsFilename(xpub: string): string {
  return `${bytesToHex(sha256(new TextEncoder().encode(xpub))).slice(0, 8)}-labels.jsonl`;
}

/** Selector inputs with each coin's label, tags, origins and freeze. */
export function withLabels<T extends { utxo: { txid: string; vout: number } }>(coins: readonly T[], labels: WalletLabels | null): (T & {
  label?: string; labelTags?: readonly LabelTag[]; labelOrigins?: readonly string[]; frozen?: boolean;
})[] {
  if (!labels) return [...coins];
  return coins.map((c) => {
    const l = labels.coins.get(`${c.utxo.txid}:${c.utxo.vout}`);
    if (!l) return c;
    return { ...c, label: l.text, labelTags: l.tags, labelOrigins: l.origins, ...(l.frozen ? { frozen: true } : {}) };
  });
}
