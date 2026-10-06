import { descriptorChecksum, isDescriptor, isXpubOrDescriptor } from "@/lib/bitcoin/descriptor";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Single-sig wrappers, in preference order. Multisig (bip48_*, p2wsh, sortedmulti) is never matched. */
const SECTIONS = [
  { key: "bip84", open: "wpkh(", close: ")" },
  { key: "bip86", open: "tr(", close: ")" },
  { key: "bip49", open: "sh(wpkh(", close: "))" },
  { key: "bip44", open: "pkh(", close: ")" },
] as const;
// No wrapper is a prefix of another ("wpkh(" vs "sh(wpkh(" vs "pkh("), so startsWith ranks exactly.
const rank = (desc: string) => SECTIONS.findIndex((s) => desc.startsWith(s.open));

/** A receive-only "/0/*" descriptor is widened to "/<0;1>/*" so change addresses are audited too. */
function widen(desc: string): string | null {
  if (!isXpubOrDescriptor(desc)) return null;
  const [body = "", chk] = desc.split("#");
  // A bad checksum is left for the parser to report, never silently replaced.
  if (!/\/0\/\*\)+$/.test(body) || (chk !== undefined && chk !== descriptorChecksum(body))) return desc;
  const wide = body.replace(/\/0\/\*(\)+)$/, "/<0;1>/*$1");
  return `${wide}#${descriptorChecksum(wide) ?? ""}`;
}

/** Coldcard Generic JSON / Sparrow export: xfp + chain + bip84/bip86/bip49/bip44 sections. */
function fromColdcard(j: Json): string | null {
  const xfp = str(j.xfp).toLowerCase();
  for (const s of SECTIONS) {
    const sec = j[s.key];
    if (!isObj(sec)) continue;
    const desc = widen(str(sec.desc));
    if (desc) return desc;
    const xpub = str(sec.xpub);
    const deriv = str(sec.deriv);
    const origin = /^[0-9a-f]{8}$/.test(xfp) && /^m(\/\d+['h]?)+$/.test(deriv)
      ? `[${xfp}${deriv.slice(1).replace(/'/g, "h")}]`
      : "";
    const body = `${s.open}${origin}${xpub}/<0;1>/*${s.close}`;
    if (isDescriptor(body)) return `${body}#${descriptorChecksum(body) ?? ""}`;
  }
  return null;
}

/** Bitcoin Core listdescriptors: array or { descriptors: [...] } of { desc, internal? }. */
function fromCore(list: unknown[]): string | null {
  const descs = list
    .filter((d): d is Json => isObj(d) && d.internal !== true)
    .map((d) => widen(str(d.desc)))
    .filter((d): d is string => d !== null && isDescriptor(d));
  return descs.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Returned when the export holds only multisig wallets (shown as the "multisig not supported" error). */
export const MULTISIG = "multisig" as const;

/** Multisig markers: Coldcard bip48_* / bip45 / p2wsh / p2sh sections, multi() descriptors, Electrum "2of3". */
function hasMultisig(j: unknown): boolean {
  if (Array.isArray(j)) return j.some((d) => isObj(d) && /multi\(/.test(str(d.desc)));
  if (!isObj(j)) return false;
  if (Array.isArray(j.descriptors)) return hasMultisig(j.descriptors);
  return Object.keys(j).some((k) => /^(bip48_|bip45|p2wsh|p2sh)/.test(k)) || /^\d+of\d+$/.test(str(j.wallet_type));
}

/**
 * Wallet-export JSON (Coldcard, Sparrow, Bitcoin Core, Electrum, Wasabi) -> a
 * descriptor or extended public key the text field accepts, MULTISIG when
 * only multisig wallets are in it, or null. Only
 * values accepted by isXpubOrDescriptor are returned, so private keys
 * (xprv/tprv/zprv, or a descriptor holding one) can never come out.
 */
export function walletJsonToPayload(text: string): string | typeof MULTISIG | null {
  const t = text.trim();
  if (!/^[{[]/.test(t)) return null;
  let j: unknown;
  try { j = JSON.parse(t); } catch { return null; }
  return singleSig(j) ?? (hasMultisig(j) ? MULTISIG : null);
}

function singleSig(j: unknown): string | null {
  if (Array.isArray(j)) return fromCore(j);
  if (!isObj(j)) return null;
  if (Array.isArray(j.descriptors)) return fromCore(j.descriptors);
  const cc = fromColdcard(j);
  if (cc) return cc;
  // Electrum: the SLIP-132 prefix (xpub/ypub/zpub) carries the script type.
  const electrum = isObj(j.keystore) ? str(j.keystore.xpub) : "";
  if (isXpubOrDescriptor(electrum)) return electrum;
  // Wasabi: a plain "xpub" that is always native segwit (taproot in TaprootExtPubKey).
  const wasabi = str(j.ExtPubKey);
  if (isDescriptor(`wpkh(${wasabi})`)) return `wpkh(${wasabi})`;
  return null;
}
