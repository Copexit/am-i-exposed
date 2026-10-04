export type Cbor =
  | number
  | bigint
  | boolean
  | null
  | string
  | Uint8Array
  | Cbor[]
  | Map<number | string, Cbor>
  | { tag: number; value: Cbor };

/** Minimal definite-length CBOR reader (enough for UR registry types). */
export function decodeCbor(bytes: Uint8Array): Cbor {
  let pos = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (n: number) => {
    if (pos + n > bytes.length) throw new Error("CBOR: unexpected end");
  };
  const arg = (info: number): number | bigint => {
    if (info < 24) return info;
    if (info === 24) { need(1); return bytes[pos++]!; }
    if (info === 25) { need(2); const v = view.getUint16(pos); pos += 2; return v; }
    if (info === 26) { need(4); const v = view.getUint32(pos); pos += 4; return v; }
    if (info === 27) {
      need(8);
      const v = view.getBigUint64(pos);
      pos += 8;
      return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
    }
    throw new Error("CBOR: indefinite lengths are not supported");
  };
  const item = (): Cbor => {
    need(1);
    const b = bytes[pos++]!;
    const major = b >> 5;
    const info = b & 0x1f;
    if (major === 7) {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      throw new Error("CBOR: unsupported simple value");
    }
    const a = arg(info);
    const len = Number(a);
    switch (major) {
      case 0: return a;
      case 1: return typeof a === "bigint" ? -1n - a : -1 - a;
      case 2: need(len); pos += len; return bytes.slice(pos - len, pos);
      case 3: need(len); pos += len; return new TextDecoder().decode(bytes.subarray(pos - len, pos));
      case 4: return Array.from({ length: len }, () => item());
      case 5: {
        const m = new Map<number | string, Cbor>();
        for (let i = 0; i < len; i++) {
          const k = item();
          if (typeof k !== "number" && typeof k !== "string") throw new Error("CBOR: unsupported map key");
          m.set(k, item());
        }
        return m;
      }
      case 6: return { tag: len, value: item() };
      default: throw new Error("CBOR: bad major type");
    }
  };
  const v = item();
  if (pos !== bytes.length) throw new Error("CBOR: trailing bytes");
  return v;
}
