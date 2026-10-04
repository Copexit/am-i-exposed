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

describe("worker decoder failure handling", () => {
  let last: FakeW;
  class FakeW {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    posts: { msg: { id: number; image: ImageData }; transfer: unknown }[] = [];
    terminated = false;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    constructor() { last = this; }
    postMessage(msg: { id: number; image: ImageData }, transfer: unknown) { this.posts.push({ msg, transfer }); }
    terminate() { this.terminated = true; }
  }
  const setup = async () => {
    vi.stubGlobal("BarcodeDetector", undefined);
    vi.stubGlobal("Worker", FakeW);
    return createFrameDecoder();
  };
  const img = () => Object.assign(new (globalThis.ImageData as unknown as new () => object)(), fakeImage) as ImageData;
  const withImageData = () => vi.stubGlobal("ImageData", class {});

  it("onerror resolves pending decodes and marks failed", async () => {
    withImageData();
    const d = await setup();
    const p = d.decode(img());
    last.onerror?.();
    expect(await p).toBeNull();
    expect(d.failed).toBe(true);
    expect(last.posts).toHaveLength(1);
    expect(await d.decode(img())).toBeNull();
    expect(last.posts).toHaveLength(1);
  });

  it("an error:true reply marks failed", async () => {
    withImageData();
    const d = await setup();
    const p = d.decode(img());
    last.onmessage?.({ data: { id: 1, text: null, error: true } } as MessageEvent);
    expect(await p).toBeNull();
    expect(d.failed).toBe(true);
  });

  it("decode after close resolves null; close resolves pending; transfer list passed", async () => {
    withImageData();
    const d = await setup();
    const image = img();
    const p = d.decode(image);
    expect(last.posts[0]?.transfer).toEqual([image.data.buffer]);
    d.close();
    expect(await p).toBeNull();
    expect(last.terminated).toBe(true);
    expect(await d.decode(img())).toBeNull();
    expect(last.posts).toHaveLength(1);
    expect(d.failed).toBe(false);
  });

  it("converts an ImageBitmap via a DOM canvas when OffscreenCanvas is missing", async () => {
    vi.stubGlobal("ImageData", class {});
    vi.stubGlobal("OffscreenCanvas", undefined);
    const data = new Uint8ClampedArray(4);
    const ctx = { drawImage: vi.fn(), getImageData: () => ({ width: 1, height: 1, data }) };
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => ctx }) });
    const d = await setup();
    const p = d.decode({ width: 1, height: 1 } as ImageBitmap);
    expect(ctx.drawImage).toHaveBeenCalled();
    last.onmessage?.({ data: { id: 1, text: "x" } } as MessageEvent);
    expect(await p).toBe("x");
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
