import { base32 } from "@scure/base";
import { hexToBytes } from "@/lib/bitcoin/hex";
import { bytesToPayload } from "./file";
import { walletJsonToPayload, MULTISIG } from "./wallet-json";

export type BbqrResult =
  | { kind: "progress"; received: number; total: number }
  | { kind: "done"; payload: string }
  | { kind: "error"; reason: "unsupported-type" | "multisig" | "corrupt" };

const HEADER_RE = /^B\$([H2Z])([A-Z])([0-9A-Z]{2})([0-9A-Z]{2})(.*)$/s;
const BODY_RE = { H: /^[0-9A-Fa-f]+$/, "2": /^[A-Z2-7]+$/, Z: /^[A-Z2-7]+$/ } as const;
const MAX_INFLATED = 4 * 1024 * 1024;

export const isBbqrPart = (text: string) => /^B\$[H2Z][A-Z]/.test(text.trim());

/** Raw-inflate with a hard output cap (deflate bombs). */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_INFLATED) {
      await reader.cancel().catch(() => {});
      throw new Error("inflated size cap exceeded");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function decodeBase32(s: string): Uint8Array {
  return base32.decode(s + "=".repeat((8 - (s.length % 8)) % 8));
}

export class BbqrDecoder {
  private key: string | null = null;
  private parts = new Map<number, string>();

  reset() { this.key = null; this.parts.clear(); }

  async receive(part: string): Promise<BbqrResult> {
    try {
      return await this.handle(part);
    } catch {
      this.reset();
      return { kind: "error", reason: "corrupt" };
    }
  }

  private async handle(part: string): Promise<BbqrResult> {
    const m = part.trim().match(HEADER_RE);
    if (!m) return { kind: "error", reason: "corrupt" };
    const enc = m[1] as "H" | "2" | "Z";
    const type = m[2] ?? "";
    const total = parseInt(m[3] ?? "", 36);
    const idx = parseInt(m[4] ?? "", 36);
    const body = m[5] ?? "";
    // Invalid frames are rejected before touching state, so they never reset a valid sequence.
    if (total < 1 || idx >= total || !BODY_RE[enc].test(body)) return { kind: "error", reason: "corrupt" };
    const key = `${enc}${type}${total}`;
    if (key !== this.key) { this.reset(); this.key = key; }
    this.parts.set(idx, body);
    if (this.parts.size < total) return { kind: "progress", received: this.parts.size, total };

    const joined = Array.from({ length: total }, (_, i) => this.parts.get(i) ?? "").join("");
    this.reset();
    let bytes = enc === "H" ? hexToBytes(joined) : decodeBase32(joined);
    if (enc === "Z") bytes = await inflateRaw(bytes);
    if (type === "P" || type === "T") return { kind: "done", payload: bytesToPayload(bytes) };
    if (type === "U") return { kind: "done", payload: new TextDecoder().decode(bytes).trim() };
    // Wallet exports (Coldcard Q "Export Wallet"): only a single-sig descriptor/xpub is taken from the JSON.
    const wallet = type === "J" ? walletJsonToPayload(new TextDecoder().decode(bytes)) : null;
    if (wallet === MULTISIG) return { kind: "error", reason: "multisig" };
    if (wallet) return { kind: "done", payload: wallet };
    return { kind: "error", reason: "unsupported-type" };
  }
}
