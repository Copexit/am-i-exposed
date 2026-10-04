import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFrameDecoder } from "../qr-decode";

const fakeImage = { width: 1, height: 1, data: new Uint8ClampedArray(4) } as unknown as ImageData;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createFrameDecoder", () => {
  it("uses the native BarcodeDetector when it supports qr_code", async () => {
    class Det {
      static getSupportedFormats() { return Promise.resolve(["qr_code"]); }
      detect() { return Promise.resolve([{ rawValue: "hello" }]); }
    }
    vi.stubGlobal("BarcodeDetector", Det);
    const d = await createFrameDecoder();
    expect(await d.decode(fakeImage)).toBe("hello");
  });

  it("falls back to the worker when BarcodeDetector is missing", async () => {
    const posted: { id: number; image: ImageData }[] = [];
    class FakeWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      constructor(public url: string, public opts: WorkerOptions) {}
      postMessage(msg: { id: number; image: ImageData }) {
        posted.push(msg);
        queueMicrotask(() => this.onmessage?.({ data: { id: msg.id, text: "from-worker" } } as MessageEvent));
      }
      terminate() {}
    }
    vi.stubGlobal("BarcodeDetector", undefined);
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("ImageData", class {});
    const img = Object.assign(new (globalThis.ImageData as unknown as new () => object)(), fakeImage) as ImageData;
    const d = await createFrameDecoder();
    expect(await d.decode(img)).toBe("from-worker");
    expect(posted[0]?.id).toBe(1);
    expect(posted[0]?.image).toBe(img);
    d.close();
  });
});

describe("qr.worker.js", () => {
  const src = readFileSync("public/workers/qr.worker.js", "utf-8");
  it("pins the wasm location and never references a CDN", () => {
    expect(src).toContain("locateFile");
    expect(src).not.toMatch(/jsdelivr|unpkg|cdn/i);
    expect(src).not.toMatch(/https?:\/\//);
  });
});
