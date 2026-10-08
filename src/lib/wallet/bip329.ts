/**
 * BIP329 wallet labels: JSON Lines parser and serializer.
 * https://github.com/bitcoin/bips/blob/master/bip-0329.mediawiki
 *
 * Tolerant like Sparrow's importer: a line that is not a valid record is
 * skipped and counted, never fatal. Every field of a record is kept as read
 * (Sparrow's height, time, fee, value, keypath, fmv...), so a file
 * round-trips. Labels never leave the browser: nothing here logs or sends.
 */

export const BIP329_TYPES = ["tx", "addr", "pubkey", "input", "output", "xpub", "spscan"] as const;
export type Bip329Type = (typeof BIP329_TYPES)[number];

/** One record. Fields other than the BIP329 core ones are kept untouched. */
export interface Bip329Record {
  type: Bip329Type;
  ref: string;
  label?: string;
  origin?: string;
  spendable?: boolean;
  [extra: string]: unknown;
}

/** Larger files are refused (a wallet's labels are a few hundred KB at most). */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** BIP329's suggested maximum, and Sparrow's (Persistable.MAX_LABEL_LENGTH): longer labels are truncated. */
export const MAX_LABEL_LENGTH = 255;
/** Automatic labels written by am-i.exposed start with this; on import they are dropped (they are recomputed). */
export const AUTO_PREFIX = "aie: ";
/** Separator between a user label and the automatic part in a merged label. */
export const AUTO_SEPARATOR = " | ";

export interface Bip329ParseResult {
  /** Valid records, deduplicated by type and ref (the last one wins), in file order */
  records: Bip329Record[];
  /** Lines that are not a valid record (bad JSON, unknown type, malformed ref or field) */
  invalid: number;
  /** Valid records with neither a label nor `spendable` (Sparrow exports every entry): ignored */
  empty: number;
  /** Labels cut to MAX_LABEL_LENGTH */
  truncated: number;
  /** Records repeated later in the file (the last one wins) */
  duplicates: number;
}

const HEX64 = /^[0-9a-f]{64}$/;
const OUTPOINT = /^[0-9a-f]{64}:\d{1,10}$/;
const PUBKEY = /^(?:[0-9a-f]{64}|0[23][0-9a-f]{64}|04[0-9a-f]{128})$/;
const BECH32 = /^(?:bc|tb|bcrt)1[02-9ac-hj-np-z]{8,87}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{25,111}$/;
const XPUB = /^[xyzXYZtuvUV]pub[1-9A-HJ-NP-Za-km-z]{100,112}$/;
const SPSCAN = /^t?spscan1[02-9ac-hj-np-z]{8,}$/;

/** Canonical ref: lowercase hex and bech32 (Sparrow matches exact, lowercase strings); null when malformed. */
export function normalizeRef(type: Bip329Type, ref: string): string | null {
  const r = ref.trim();
  switch (type) {
    case "tx": return HEX64.test(r.toLowerCase()) ? r.toLowerCase() : null;
    case "input":
    case "output": return OUTPOINT.test(r.toLowerCase()) ? r.toLowerCase() : null;
    case "pubkey": return PUBKEY.test(r.toLowerCase()) ? r.toLowerCase() : null;
    case "addr": {
      const lower = r.toLowerCase();
      if (BECH32.test(lower) && (r === lower || r === r.toUpperCase())) return lower;
      return BASE58.test(r) ? r : null;
    }
    case "xpub": return XPUB.test(r) ? r : null;
    case "spscan": return SPSCAN.test(r.toLowerCase()) ? r.toLowerCase() : null;
  }
}

export const recordKey = (r: Pick<Bip329Record, "type" | "ref">) => `${r.type}:${r.ref}`;

/**
 * The user's part of a label: automatic parts ("aie: ...", or "<label> | aie: ...")
 * are dropped, since they are recomputed from the scan. Empty when only automatic.
 */
export function userPart(label: string): string {
  if (label.startsWith(AUTO_PREFIX)) return "";
  const i = label.indexOf(AUTO_SEPARATOR + AUTO_PREFIX);
  return (i >= 0 ? label.slice(0, i) : label).trim();
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Byte length of a string as UTF-8. */
export const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

/** Parse a BIP329 JSON Lines document. Returns null when it is larger than MAX_FILE_BYTES. */
export function parseBip329(text: string): Bip329ParseResult | null {
  if (text.length > MAX_FILE_BYTES || utf8Bytes(text) > MAX_FILE_BYTES) return null;
  const byKey = new Map<string, Bip329Record>();
  let invalid = 0, empty = 0, truncated = 0, duplicates = 0;
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let obj: unknown;
    try { obj = JSON.parse(line); } catch { invalid++; continue; }
    if (!isPlainObject(obj)) { invalid++; continue; }
    const { type, ref, label, origin, spendable } = obj;
    if (typeof type !== "string" || !(BIP329_TYPES as readonly string[]).includes(type) || typeof ref !== "string") { invalid++; continue; }
    const norm = normalizeRef(type as Bip329Type, ref);
    // A wrong-typed optional field (e.g. "spendable": "false") makes the line invalid, not silently misread.
    if (norm === null || (label !== undefined && label !== null && typeof label !== "string")
      || (origin !== undefined && origin !== null && typeof origin !== "string")
      || (spendable !== undefined && spendable !== null && typeof spendable !== "boolean")
      || (typeof spendable === "boolean" && type !== "output")) { invalid++; continue; }

    const rec: Bip329Record = { ...obj, type: type as Bip329Type, ref: norm };
    // null means "not set" (some exporters write it); drop it so the record stays canonical
    for (const k of ["label", "origin", "spendable"] as const) if (rec[k] === null) delete rec[k];
    if (typeof rec.label === "string") {
      let l = userPart(rec.label.replace(/[\r\n]+/g, " "));
      if (l.length > MAX_LABEL_LENGTH) { l = l.slice(0, MAX_LABEL_LENGTH); truncated++; }
      if (l) rec.label = l;
      else delete rec.label;
    }
    if (rec.label === undefined && rec.spendable === undefined) { empty++; continue; }
    const key = recordKey(rec);
    if (byKey.has(key)) { duplicates++; byKey.delete(key); }
    byKey.set(key, rec);
  }
  return { records: [...byKey.values()], invalid, empty, truncated, duplicates };
}

/** Serialize records as BIP329 JSON Lines (one object per line, `\n` after each). */
export function serializeBip329(records: readonly Bip329Record[]): string {
  return records.map((r) => JSON.stringify(r) + "\n").join("");
}
