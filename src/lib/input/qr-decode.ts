// src/lib/input/qr-decode.ts
/**
 * `failed` becomes true when the decoder cannot work (worker/module/wasm load failure or crash).
 * decode() then resolves null immediately; callers should check `failed` after a null result
 * to tell "decoder unavailable" apart from "no QR in this frame".
 */
export interface FrameDecoder { decode(source: ImageBitmap | ImageData): Promise<string | null>; close(): void; readonly failed: boolean }

interface NativeDetector { detect(src: ImageBitmapSource): Promise<{ rawValue: string }[]> }
type DetectorCtor = { new (o: { formats: string[] }): NativeDetector; getSupportedFormats(): Promise<string[]> };

function toImageData(src: ImageBitmap | ImageData): ImageData {
  if (src instanceof ImageData) return src;
  // Safari < 16.4 has no 2D OffscreenCanvas: fall back to a DOM canvas.
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  if (typeof OffscreenCanvas !== "undefined") {
    ctx = new OffscreenCanvas(src.width, src.height).getContext("2d");
  }
  if (!ctx) {
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    ctx = c.getContext("2d");
  }
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.drawImage(src, 0, 0);
  return ctx.getImageData(0, 0, src.width, src.height);
}

async function nativeDecoder(): Promise<FrameDecoder | null> {
  const Ctor = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    if (!(await Ctor.getSupportedFormats()).includes("qr_code")) return null;
    const d = new Ctor({ formats: ["qr_code"] });
    return {
      decode: async (src) => (await d.detect(src))[0]?.rawValue ?? null,
      close: () => {},
      failed: false,
    };
  } catch {
    return null;
  }
}

function workerDecoder(): FrameDecoder {
  const worker = new Worker("/workers/qr.worker.js", { type: "module" });
  let seq = 0;
  let closed = false;
  let failed = false;
  const waiting = new Map<number, (t: string | null) => void>();
  const flush = () => { waiting.forEach((r) => r(null)); waiting.clear(); };
  const fail = () => { failed = true; flush(); };
  worker.onmessage = (e: MessageEvent<{ id: number; text: string | null; error?: boolean }>) => {
    if (e.data.error) { fail(); return; }
    waiting.get(e.data.id)?.(e.data.text);
    waiting.delete(e.data.id);
  };
  worker.onerror = fail;
  worker.onmessageerror = fail;
  return {
    get failed() { return failed; },
    decode: (src) => {
      if (closed || failed) return Promise.resolve(null);
      const image = toImageData(src); // before waiting.set so a throw leaks nothing
      return new Promise((resolve) => {
        const id = ++seq;
        waiting.set(id, resolve);
        worker.postMessage({ id, image }, [image.data.buffer]);
      });
    },
    close: () => { closed = true; worker.terminate(); flush(); },
  };
}

export async function createFrameDecoder(): Promise<FrameDecoder> {
  return (await nativeDecoder()) ?? workerDecoder();
}

/** Long-side cap for photos: a 48 MP photo would otherwise be a ~190 MB ImageData. */
export const MAX_PHOTO_SIDE = 2000;

/** Size that fits within `max` on the long side keeping the aspect ratio, or null if it already fits. */
export function fitWithin(width: number, height: number, max = MAX_PHOTO_SIDE): { width: number; height: number } | null {
  const long = Math.max(width, height);
  if (long <= max) return null;
  const k = max / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Photo fallback (works without a secure context): one static QR from an image file. */
export async function decodeImageFile(file: File): Promise<string | null> {
  let bitmap = await createImageBitmap(file);
  const fit = fitWithin(bitmap.width, bitmap.height);
  if (fit) {
    // Browsers without resize options return it full size: still decodes, just heavier.
    const small = await createImageBitmap(bitmap, { resizeWidth: fit.width, resizeHeight: fit.height, resizeQuality: "high" });
    bitmap.close();
    bitmap = small;
  }
  const decoder = await createFrameDecoder();
  try {
    return await decoder.decode(bitmap);
  } finally {
    decoder.close();
    bitmap.close();
  }
}
