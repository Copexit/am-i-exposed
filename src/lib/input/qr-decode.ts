// src/lib/input/qr-decode.ts
export interface FrameDecoder { decode(source: ImageBitmap | ImageData): Promise<string | null>; close(): void }

interface NativeDetector { detect(src: ImageBitmapSource): Promise<{ rawValue: string }[]> }
type DetectorCtor = { new (o: { formats: string[] }): NativeDetector; getSupportedFormats(): Promise<string[]> };

function toImageData(src: ImageBitmap | ImageData): ImageData {
  if (src instanceof ImageData) return src;
  const c = new OffscreenCanvas(src.width, src.height);
  const ctx = c.getContext("2d");
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
    };
  } catch {
    return null;
  }
}

function workerDecoder(): FrameDecoder {
  const worker = new Worker("/workers/qr.worker.js", { type: "module" });
  let seq = 0;
  const waiting = new Map<number, (t: string | null) => void>();
  worker.onmessage = (e: MessageEvent<{ id: number; text: string | null }>) => {
    waiting.get(e.data.id)?.(e.data.text);
    waiting.delete(e.data.id);
  };
  return {
    decode: (src) => new Promise((resolve) => {
      const id = ++seq;
      waiting.set(id, resolve);
      const image = toImageData(src);
      worker.postMessage({ id, image }, [image.data.buffer]);
    }),
    close: () => { worker.terminate(); waiting.forEach((r) => r(null)); waiting.clear(); },
  };
}

export async function createFrameDecoder(): Promise<FrameDecoder> {
  return (await nativeDecoder()) ?? workerDecoder();
}

/** Photo fallback (works without a secure context): one static QR from an image file. */
export async function decodeImageFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const decoder = await createFrameDecoder();
  try {
    return await decoder.decode(bitmap);
  } finally {
    decoder.close();
    bitmap.close();
  }
}
