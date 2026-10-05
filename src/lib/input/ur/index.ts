import { decodeMinimalBytewords } from "./bytewords";
import { FountainDecoder, parsePart } from "./fountain";
import { urToPayload } from "./registry";

export type UrResult =
  | { kind: "progress"; percent: number }
  | { kind: "done"; payload: string }
  | { kind: "error"; reason: "unsupported-type" | "multisig" | "corrupt" };

export const isUrPart = (text: string) => /^ur:/i.test(text.trim());

export class UrDecoder {
  private fountain = new FountainDecoder();
  private type: string | null = null;

  reset() { this.fountain = new FountainDecoder(); this.type = null; }

  receive(part: string): UrResult {
    const m = part.trim().toLowerCase().match(/^ur:([a-z0-9-]+)\/(?:(\d+)-(\d+)\/)?([a-z]+)$/);
    if (!m) return { kind: "error", reason: "corrupt" };
    const [, type, seq, , body] = m as [string, string, string | undefined, string | undefined, string];
    try {
      if (type !== this.type) { this.reset(); this.type = type; }
      const bytes = decodeMinimalBytewords(body);
      if (!seq) return { kind: "done", payload: urToPayload(type, bytes) };
      const msg = this.fountain.receive(parsePart(bytes));
      if (!msg) return { kind: "progress", percent: Math.round(this.fountain.progress * 100) };
      this.reset();
      return { kind: "done", payload: urToPayload(type, msg) };
    } catch (err) {
      const reason = err instanceof Error && (err.message === "multisig" || err.message === "unsupported-type") ? err.message : "corrupt";
      return { kind: "error", reason };
    }
  }
}
