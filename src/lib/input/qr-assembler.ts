import { UrDecoder, isUrPart } from "./ur";
import { BbqrDecoder, isBbqrPart } from "./bbqr";
import { walletJsonToPayload } from "./wallet-json";

export type AssemblerState =
  | { kind: "idle" }
  | { kind: "progress"; format: "ur" | "bbqr"; percent: number; received?: number; total?: number }
  | { kind: "done"; payload: string }
  | { kind: "error"; reason: "unsupported-type" | "multisig" };

/** Feeds decoded QR frames (static text, BC-UR, BBQr) and tracks the assembled result. */
export class QrAssembler {
  private ur = new UrDecoder();
  private bbqr = new BbqrDecoder();
  private last: string | null = null;
  private state: AssemblerState = { kind: "idle" };
  private queue: Promise<unknown> = Promise.resolve();
  private gen = 0;

  /** Synchronous; in-flight pushes from an earlier generation are discarded. */
  reset() {
    this.gen++;
    this.ur.reset();
    this.bbqr.reset();
    this.last = null;
    this.state = { kind: "idle" };
  }

  /** Pushes are serialized so overlapping async BBQr calls cannot interleave. */
  push(text: string): Promise<AssemblerState> {
    const gen = this.gen;
    const run = this.queue.then(() => this.handle(text, gen));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async handle(text: string, gen: number): Promise<AssemblerState> {
    if (gen !== this.gen) return { kind: "idle" };
    if (text === this.last) return this.state;
    this.last = text;
    if (isUrPart(text)) {
      this.bbqr.reset();
      const r = this.ur.receive(text);
      if (r.kind === "error") return r.reason === "corrupt" ? this.state : (this.state = { kind: "error", reason: r.reason });
      return (this.state = r.kind === "done" ? r : { kind: "progress", format: "ur", percent: r.percent });
    }
    if (isBbqrPart(text)) {
      this.ur.reset();
      const r = await this.bbqr.receive(text);
      if (gen !== this.gen) return { kind: "idle" };
      if (r.kind === "error") return r.reason === "corrupt" ? this.state : (this.state = { kind: "error", reason: "unsupported-type" });
      return (this.state = r.kind === "done" ? r : { kind: "progress", format: "bbqr", percent: Math.round((r.received / r.total) * 100), received: r.received, total: r.total });
    }
    return (this.state = { kind: "done", payload: walletJsonToPayload(text) ?? text.trim() });
  }
}
