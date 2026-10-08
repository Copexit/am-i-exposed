/**
 * Wallet labels (BIP329) against a scanned wallet: which records match it,
 * the labeling convention's origin prefixes, the label each coin carries
 * (its own, its address's, or inherited from the coins that funded it), and
 * the labels exported back, with automatic "aie:" labels.
 *
 * Convention (guide, "Labeling recommendations"): `[ORIGIN] observer · platform or reason · fiat value`, with the
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
  /** Text before the first "·" after the prefixes: the observer, whoever can link the coin to you */
  who: string;
  /** Second field: the platform or reason ("RoboSats purchase"), when present */
  platform?: string;
  /** A field holding a fiat value at the time ("250 EUR", "250 EUR (73.600 EUR/BTC)"), when present */
  fiat?: { text: string; currency: string };
  /** Sparrow's suffix on a label copied from the transaction to its output ("received", "change"; "sent" in BIP47 wallets) */
  suffix?: SparrowSuffix;
}

export type SparrowSuffix = "received" | "change" | "sent" | "input";
/**
 * Sparrow copies a transaction label to the wallet's outputs of that
 * transaction with " (received)" or " (change)" (" (sent)" in BIP47 wallets)
 * appended, and to the inputs that spend them with " (input)". The suffixes
 * are hard-coded English whatever the UI language (WalletForm.walletLabelsChanged,
 * HeadersController).
 */
const SPARROW_SUFFIX = / \((received|change|sent|input)\)$/;

/** A fiat amount field: digits (with . , or spaces as separators) and a 3-letter currency, optionally a rate in parentheses. */
const AMOUNT = String.raw`\d[\d.,\s]*?`;
const CUR = String.raw`([A-Za-z]{3}|[€$£])`;
const RATE = String.raw`(?:\s*\(.*\))?`;
const FIAT_RES = [
  new RegExp(String.raw`^[~≈]?\s*${AMOUNT}\s?${CUR}${RATE}$`), // 250 EUR, 250 €, 1.000 EUR (73.600 EUR/BTC)
  new RegExp(String.raw`^[~≈]?\s*${CUR}\s?${AMOUNT}${RATE}$`), // €250, EUR 250
];
const SYMBOL: Record<string, string> = { "€": "EUR", "$": "USD", "£": "GBP" };
/** Bitcoin units are amounts, not a fiat value. */
const NOT_FIAT = new Set(["BTC", "XBT", "SAT"]);

/** The currency of a fiat amount field, or null. */
function fiatCurrency(field: string): string | null {
  for (const re of FIAT_RES) {
    const m = re.exec(field);
    if (!m) continue;
    const cur = SYMBOL[m[1]!] ?? m[1]!.toUpperCase();
    return NOT_FIAT.has(cur) ? null : cur;
  }
  return null;
}

/** A label without Sparrow's trailing suffix, and the suffix. */
export function stripSuffix(label: string): { text: string; suffix?: SparrowSuffix } {
  const m = SPARROW_SUFFIX.exec(label.trimEnd());
  return m ? { text: label.trimEnd().slice(0, m.index), suffix: m[1] as SparrowSuffix } : { text: label };
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s_-]+/g, "");

/** Parse the `[ORIGIN] who · detail` convention. Unknown bracketed words stay in the text. */
export function parseLabel(label: string): ParsedLabel {
  const tags: LabelTag[] = [];
  const { text, suffix } = stripSuffix(label);
  let rest = text.trimStart();
  for (let m = /^\[([^\]]{1,24})\]\s*/.exec(rest); m; m = /^\[([^\]]{1,24})\]\s*/.exec(rest)) {
    const tag = TAG_WORDS[norm(m[1]!)];
    if (!tag) break;
    if (!tags.includes(tag)) tags.push(tag);
    rest = rest.slice(m[0].length);
  }
  // `[ORIGIN] observer · platform or reason · fiat value at the time`, every part optional.
  const fields = rest.split("·").map((f) => f.trim());
  const parsed: ParsedLabel = { tags, who: fields[0]! };
  const fiatAt = fields.findIndex((f, i) => i > 0 && fiatCurrency(f) !== null);
  const platform = fields.slice(1).find((f, i) => i + 1 !== fiatAt && f);
  if (platform) parsed.platform = platform;
  if (fiatAt > 0) parsed.fiat = { text: fields[fiatAt]!, currency: fiatCurrency(fields[fiatAt]!)! };
  if (suffix) parsed.suffix = suffix;
  return parsed;
}

/** Origin keys of a parsed label: origin tag plus counterparty, e.g. "kyc:bitstamp". */
function originKeys({ tags, who }: ParsedLabel): string[] {
  return tags.filter((t) => ORIGIN_TAGS.has(t)).map((t) => `${t}:${who.toLowerCase()}`);
}

// ---------- Matching ----------

/** The label a wallet coin carries. */
export interface CoinLabel {
  /** Label text (without Sparrow's suffix): the output's own, else its address's, else its funding transaction's */
  text?: string;
  source?: "output" | "addr" | "tx";
  /** Sparrow's " (received)" / " (change)" suffix on the text, when present */
  suffix?: SparrowSuffix;
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
  /** Records that give a current coin its label */
  onCoins: number;
  /** Matched records on spent coins, past transactions, addresses and keys (and key records that cannot be checked) */
  history: number;
  /** Wallet-level origin from the wallet's xpub record ("[noKYC] wallet"), or null */
  walletOrigin: WalletOrigin | null;
  /** Some label uses an origin prefix, or the wallet has an origin: the origin rules have something to check */
  hasPrefixes: boolean;
  tx: ReadonlyMap<string, string>;
  addr: ReadonlyMap<string, string>;
  /** Unspent coins with a label, a tag or a freeze, by "txid:vout" */
  coins: ReadonlyMap<string, CoinLabel>;
  /** Display name of each origin key (the counterparty as first written) */
  originNames: ReadonlyMap<string, string>;
  /** Labels that disagree with what the chain shows (informational, no score impact) */
  checks: LabelCheck[];
}

/**
 * A label that disagrees with on-chain facts. `refs` are outpoints.
 * - cj-not-mixed: labeled [CJ] but not a CoinJoin output
 * - mixed-unlabeled: a CoinJoin output with no [CJ] label while [CJ] or other origin prefixes are in use
 * - suffix-chain: Sparrow's "(received)" on a change-chain address, or "(change)" on a receive one
 * - change-on-receive: labeled [change] but received from someone else
 * - kyc-linked: [KYC] and [noKYC] coins already linked on-chain (same address or a past spend)
 * - stale-freeze: a frozen output that is already spent
 * - wallet-origin-mismatch: a coin whose origin differs from the wallet-level origin
 */
export type LabelCheckId = "cj-not-mixed" | "mixed-unlabeled" | "suffix-chain" | "change-on-receive" | "kyc-linked" | "stale-freeze" | "wallet-origin-mismatch";
export interface LabelCheck { id: LabelCheckId; refs: string[] }

// ---------- Wallet-level origin ----------

/**
 * What a whole wallet (account) holds, for users who keep one account per
 * origin: coins with no origin of their own take it. Stored as the prefix of
 * the wallet's BIP329 `xpub` record ("[noKYC] wallet"); "[mixed]" says the
 * wallet mixes origins on purpose.
 */
export type WalletOrigin = "kyc" | "nokyc" | "cj" | "mixed";
export const WALLET_ORIGINS: readonly WalletOrigin[] = ["kyc", "nokyc", "cj", "mixed"];
const WALLET_PREFIX: Record<WalletOrigin, string> = { kyc: "[KYC]", nokyc: "[noKYC]", cj: "[CJ]", mixed: "[mixed]" };
const MIXED_RE = /^\s*\[mixed\]\s*/i;

/** The wallet origin a label sets, or null. */
export function walletOriginOf(label: string | undefined): WalletOrigin | null {
  if (!label) return null;
  if (MIXED_RE.test(label)) return "mixed";
  const tag = parseLabel(label).tags.find((t) => t === "kyc" || t === "nokyc" || t === "cj");
  return (tag as WalletOrigin | undefined) ?? null;
}

/**
 * Records with the wallet origin set (or cleared, null) on the wallet's xpub
 * record: the prefix replaces any origin prefix of the existing label, the
 * rest is kept ("BIP39" becomes "[noKYC] BIP39"), cut to MAX_LABEL_LENGTH.
 */
export function setWalletOrigin(records: readonly Bip329Record[], xpub: string, origin: WalletOrigin | null): Bip329Record[] {
  const i = records.findIndex((r) => r.type === "xpub" && r.ref === xpub);
  const old = i >= 0 ? records[i]!.label ?? "" : "";
  // Strip the old origin prefixes, keep the rest
  let rest = old.replace(MIXED_RE, "");
  for (let m = /^\s*\[([^\]]{1,24})\]\s*/.exec(rest); m && TAG_WORDS[norm(m[1]!)]; m = /^\s*\[([^\]]{1,24})\]\s*/.exec(rest)) rest = rest.slice(m[0].length);
  // "wallet" is the placeholder written when there was no label: cleared with the origin.
  const label = origin ? `${WALLET_PREFIX[origin]} ${rest || "wallet"}`.slice(0, MAX_LABEL_LENGTH) : rest === "wallet" ? "" : rest;
  const { label: _old, ...base } = i >= 0 ? records[i]! : { type: "xpub" as const, ref: xpub };
  const next: Bip329Record = label ? { ...base, label } : base;
  // A record left with nothing but type and ref says nothing: dropped.
  const keep = Object.keys(next).length > 2;
  if (i < 0) return keep ? [...records, next] : [...records];
  return keep ? records.map((r, j) => (j === i ? next : r)) : records.filter((_, j) => j !== i);
}

/** Match records against the scanned wallet and resolve each unspent coin's label. */
export function matchLabels(records: readonly Bip329Record[], infos: readonly WalletAddressInfo[], xpub?: string): WalletLabels {
  const g = buildWalletGraph(infos);
  const tx = new Map<string, string>();
  const addr = new Map<string, string>();
  const outputs = new Map<string, Bip329Record>();
  let applied = 0;
  let unverifiable = 0;
  let walletOrigin: WalletOrigin | null = null;
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
      case "xpub": ok = r.ref === xpub; if (ok) walletOrigin = walletOriginOf(r.label); break;
      // ponytail: pubkey and spscan records are not matched (no key derivation here); they still round-trip on export.
      default: ok = false;
    }
    if (ok) applied++;
    // A key record that is not this wallet's key, or cannot be checked, is not "another wallet's".
    else if (r.type === "xpub" || r.type === "pubkey" || r.type === "spscan") unverifiable++;
  }
  // One origin for the whole wallet (KYC, no-KYC or post-mix): coins with no origin of their own take it.
  const single: LabelTag | null = walletOrigin && walletOrigin !== "mixed" ? walletOrigin : null;

  /**
   * A tx label names a coin's origin only when the tx is a receipt: on the
   * wallet's own spends it is the payment's purpose ("[noKYC] paid Juan"),
   * and the change inherits from the inputs instead (rule 4).
   */
  const receipt = (txid: string) => {
    const t = g.txs.get(txid);
    return !!t && !t.vin.some((v) => isOwn(g, v.prevout?.scriptpubkey_address));
  };
  const incomingTxLabel = (txid: string) => (receipt(txid) ? tx.get(txid) : undefined);

  // Own label first; a coin with no origin tag that the wallet funded inherits its inputs' origins (rule 4).
  const memo = new Map<string, { tags: LabelTag[]; origins: string[] }>();
  const originNames = new Map<string, string>();
  const resolve = (txid: string, vout: number, depth: number): { tags: LabelTag[]; origins: string[] } => {
    const k = `${txid}:${vout}`;
    const hit = memo.get(k);
    if (hit) return hit;
    const fundTx = g.txs.get(txid);
    const text = outputs.get(k)?.label ?? addr.get(fundTx?.vout[vout]?.scriptpubkey_address ?? "") ?? incomingTxLabel(txid);
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
  /**
   * The wallet origin goes only to coins with no origin of their own (own or
   * inherited): an explicit prefix wins, and a prefix that disagrees with the
   * wallet origin is flagged by the label check (wallet-origin-mismatch).
   */
  const withWallet = (r: { tags: LabelTag[]; origins: string[] }) => {
    if (!single || r.tags.some((t) => ORIGIN_TAGS.has(t))) return r;
    return { tags: [single, ...r.tags], origins: r.origins.length ? r.origins : [`${single}:`] };
  };

  const coins = new Map<string, CoinLabel>();
  /** Records that give a current coin its label */
  const used = new Set<string>();
  for (const info of infos) {
    for (const u of info.utxos) {
      const k = `${u.txid}:${u.vout}`;
      const rec = outputs.get(k);
      const addrText = addr.get(info.derived.address);
      const raw = rec?.label ?? addrText ?? tx.get(u.txid);
      const source = rec?.label ? "output" : addrText ? "addr" : raw ? "tx" : undefined;
      if (source) used.add(source === "output" ? `output:${k}` : source === "addr" ? `addr:${info.derived.address}` : `tx:${u.txid}`);
      if (rec?.spendable === false) used.add(`output:${k}`);
      const { tags, origins } = withWallet(resolve(u.txid, u.vout, 0));
      const parsed = raw ? parseLabel(raw) : null;
      // A spend's tx label is shown but says nothing about this coin's origin.
      const ownTags = source === "tx" && !receipt(u.txid) ? [] : parsed?.tags ?? [];
      const frozen = rec?.spendable === false;
      if (!raw && tags.length === 0 && !frozen) continue;
      coins.set(k, {
        // Shown without Sparrow's suffix; the suffix is kept for the label check.
        text: raw === undefined ? undefined : stripSuffix(raw).text, source,
        ...(parsed?.suffix ? { suffix: parsed.suffix } : {}),
        tags, inherited: tags.some((t) => !ownTags.includes(t)), origins, frozen,
      });
    }
  }
  const originPrefixInUse = single !== null || records.some((r) => r.label !== undefined && parseLabel(r.label).tags.some((t) => ORIGIN_TAGS.has(t)));
  const checks = labelChecks(infos, g, coins, outputs, single, originPrefixInUse);
  const onCoins = used.size;
  const unmatched = records.length - applied - unverifiable;
  return {
    records, applied, unmatched, onCoins, history: records.length - unmatched - onCoins, walletOrigin,
    hasPrefixes: (walletOrigin !== null && walletOrigin !== "mixed") || records.some((r) => r.label !== undefined && parseLabel(r.label).tags.length > 0),
    tx, addr, coins, originNames, checks,
  };
}

/** Labels against the chain: see LabelCheck. Pure, informational. */
function labelChecks(
  infos: readonly WalletAddressInfo[],
  g: ReturnType<typeof buildWalletGraph>,
  coins: ReadonlyMap<string, CoinLabel>,
  outputs: ReadonlyMap<string, Bip329Record>,
  walletOrigin: LabelTag | null,
  /** Some label uses [CJ] or another origin prefix: only then is a CoinJoin output without [CJ] worth a note */
  originPrefixInUse: boolean,
): LabelCheck[] {
  const checks: LabelCheck[] = [];
  const add = (id: LabelCheckId, ref: string) => {
    const c = checks.find((x) => x.id === id);
    if (c) c.refs.push(ref);
    else checks.push({ id, refs: [ref] });
  };
  const inputs = buildCoinInputs([...infos]);
  const byKey = new Map(inputs.map((c) => [`${c.utxo.txid}:${c.utxo.vout}`, c]));
  const chainOf = new Map(infos.map((i) => [i.derived.address, i.derived.isChange]));
  for (const [k, c] of byKey) {
    const l = coins.get(k);
    const own = l?.text ? parseLabel(l.text) : null;
    const mixed = c.origin === "mixed";
    if (own?.tags.includes("cj") && !mixed) add("cj-not-mixed", k);
    if (mixed && originPrefixInUse && !l?.tags.includes("cj")) add("mixed-unlabeled", k);
    const isChange = chainOf.get(c.address);
    if (l?.suffix && l.source !== "tx" && ((l.suffix === "received" && isChange) || (l.suffix === "change" && isChange === false))) add("suffix-chain", k);
    if (own?.tags.includes("change") && isChange === false && c.origin === "received") add("change-on-receive", k);
    // An origin other than the wallet's: the wallet-level origin says this wallet holds only one
    if (walletOrigin && l && l.tags.some((t) => ORIGIN_TAGS.has(t)) && !l.tags.includes(walletOrigin)) add("wallet-origin-mismatch", k);
  }
  // [KYC] and [noKYC] in one certain cluster (same address, or a past spend): already linked on-chain.
  const tagsByCluster = new Map<string, { kyc: string[]; nokyc: string[] }>();
  for (const [k, c] of byKey) {
    const tags = coins.get(k)?.tags ?? [];
    if (!c.cluster || !(tags.includes("kyc") || tags.includes("nokyc"))) continue;
    let e = tagsByCluster.get(c.cluster);
    if (!e) tagsByCluster.set(c.cluster, (e = { kyc: [], nokyc: [] }));
    if (tags.includes("kyc")) e.kyc.push(k);
    if (tags.includes("nokyc")) e.nokyc.push(k);
  }
  // A coin carrying both (change of a merge of the two) is the past spend itself.
  for (const e of tagsByCluster.values()) if (e.kyc.length && e.nokyc.length) for (const k of [...new Set([...e.kyc, ...e.nokyc])]) add("kyc-linked", k);
  // A freeze on an output the wallet already spent does nothing: stale.
  const spent = new Set([...g.txs.values()].flatMap((t) => t.vin.map((v) => `${v.txid}:${v.vout}`)));
  for (const [k, r] of outputs) if (r.spendable === false && spent.has(k)) add("stale-freeze", k);
  return checks;
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

// ---------- Fiat value at the time ----------

/**
 * Tx records of incoming payments with " · N CUR" appended: the wallet's
 * received amount at the price of the tx's block time. Only labels with no
 * fiat value yet; anything else is returned as is. `price` is called once
 * per hour of block time with that hour's timestamp only (never a txid or an
 * address).
 */
export async function withFiatValues(
  records: readonly Bip329Record[],
  infos: readonly WalletAddressInfo[],
  price: (timestamp: number) => Promise<number | null>,
  currency = "USD",
): Promise<Bip329Record[]> {
  const g = buildWalletGraph(infos);
  const prices = new Map<number, Promise<number | null>>();
  // Rounded to the hour: fewer lookups, and the exact block time is not sent.
  const priceAt = (time: number) => {
    const ts = Math.floor(time / 3600) * 3600;
    let p = prices.get(ts);
    if (!p) prices.set(ts, (p = price(ts).catch(() => null)));
    return p;
  };
  return Promise.all(records.map(async (r) => {
    if (r.type !== "tx" || !r.label || parseLabel(r.label).fiat) return r;
    const t = g.txs.get(r.ref);
    const ts = t?.status.block_time;
    // Incoming: the wallet receives and spends nothing of its own in it
    if (!t || !ts || t.vin.some((v) => isOwn(g, v.prevout?.scriptpubkey_address))) return r;
    const sats = t.vout.reduce((s, o) => s + (isOwn(g, o.scriptpubkey_address) ? o.value : 0), 0);
    const p = sats > 0 ? await priceAt(ts) : null;
    if (!p) return r;
    const { text, suffix } = stripSuffix(r.label);
    const label = `${text} · ${Math.round((sats / 1e8) * p)} ${currency}${suffix ? ` (${suffix})` : ""}`;
    return label.length <= MAX_LABEL_LENGTH ? { ...r, label } : r;
  }));
}
