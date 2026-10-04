import { createBase58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { bytesToPayload } from "@/lib/input/file";
import { decodeCbor, type Cbor } from "./cbor";

const b58c = createBase58check(sha256);
type Tagged = { tag: number; value: Cbor };
const isTagged = (v: Cbor): v is Tagged => typeof v === "object" && v !== null && "tag" in v;
const untag = (v: Cbor, tag: number): Cbor => (isTagged(v) && v.tag === tag ? v.value : v);
const asMap = (v: Cbor) => { if (!(v instanceof Map)) throw new Error("unsupported-type"); return v; };
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0); return b; };

/** crypto-hdkey (303) -> [fp/path]xpub */
function hdkeyToKeyExpr(v: Cbor): string {
  const m = asMap(untag(v, 303));
  const key = m.get(3), chain = m.get(4);
  if (!(key instanceof Uint8Array) || !(chain instanceof Uint8Array)) throw new Error("unsupported-type");
  const useInfo = m.get(5) ? asMap(untag(m.get(5)!, 305)) : null;
  const testnet = useInfo?.get(2) === 1;
  const origin = m.get(6) ? asMap(untag(m.get(6)!, 304)) : null;
  const comps = (origin?.get(1) as Cbor[] | undefined) ?? [];
  const path: { index: number; hardened: boolean }[] = [];
  for (let i = 0; i + 1 < comps.length; i += 2) path.push({ index: comps[i] as number, hardened: comps[i + 1] === true });
  const sourceFp = typeof origin?.get(2) === "number" ? (origin.get(2) as number) : null;
  const depth = typeof origin?.get(3) === "number" ? (origin.get(3) as number) : path.length;
  const last = path[path.length - 1];
  const childNum = last ? (last.index + (last.hardened ? 0x80000000 : 0)) >>> 0 : 0;
  const parentFp = typeof m.get(8) === "number" ? (m.get(8) as number) : 0;

  const ser = new Uint8Array(78);
  ser.set(u32(testnet ? 0x043587cf : 0x0488b21e), 0);
  ser[4] = depth;
  ser.set(u32(parentFp), 5);
  ser.set(u32(childNum), 9);
  ser.set(chain, 13);
  ser.set(key, 45);
  const xpub = b58c.encode(ser);
  if (sourceFp === null) return xpub;
  const pathStr = path.map((c) => `/${c.index}${c.hardened ? "h" : ""}`).join("");
  return `[${bytesToHex(u32(sourceFp))}${pathStr}]${xpub}`;
}

/** Script expression tags (BCR-2020-010) -> descriptor; multisig and others rejected. */
function outputToDescriptor(v: Cbor): string {
  const e = untag(v, 308);
  if (!isTagged(e)) throw new Error("unsupported-type");
  switch (e.tag) {
    case 404: return `wpkh(${hdkeyToKeyExpr(e.value)})`;
    case 403: return `pkh(${hdkeyToKeyExpr(e.value)})`;
    case 409: return `tr(${hdkeyToKeyExpr(e.value)})`;
    case 400: {
      const inner = e.value;
      if (isTagged(inner) && inner.tag === 404) return `sh(wpkh(${hdkeyToKeyExpr(inner.value)}))`;
      if (isTagged(inner) && (inner.tag === 406 || inner.tag === 407)) throw new Error("multisig");
      throw new Error("unsupported-type");
    }
    case 401: case 406: case 407: throw new Error("multisig");
    default: throw new Error("unsupported-type");
  }
}

const ACCOUNT_PREFERENCE = [404, 409, 400, 403];

/** UR type + CBOR body -> the canonical string the text field accepts. */
export function urToPayload(type: string, cbor: Uint8Array): string {
  const v = decodeCbor(cbor);
  switch (type) {
    case "crypto-psbt": case "psbt": case "bytes": {
      const bytes = untag(v, type === "psbt" ? 40310 : 310);
      if (!(bytes instanceof Uint8Array)) throw new Error("unsupported-type");
      return bytesToPayload(bytes);
    }
    case "crypto-output": case "output-descriptor":
      return outputToDescriptor(v);
    case "crypto-hdkey": case "hdkey":
      return hdkeyToKeyExpr(v).replace(/^\[[^\]]*\]/, ""); // a bare xpub scans as a wallet
    case "crypto-account": case "account-descriptor": {
      const outs = (asMap(untag(v, 311)).get(2) as Cbor[] | undefined) ?? [];
      const rank = (o: Cbor) => { const e = untag(o, 308); return isTagged(e) ? ACCOUNT_PREFERENCE.indexOf(e.tag) : -1; };
      const best = outs.filter((o) => rank(o) >= 0).sort((a, b) => rank(a) - rank(b))[0];
      if (!best) throw new Error(outs.length ? "multisig" : "unsupported-type");
      return outputToDescriptor(best);
    }
    default:
      throw new Error("unsupported-type");
  }
}
