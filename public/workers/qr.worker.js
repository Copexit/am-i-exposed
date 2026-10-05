// QR decoding off the main thread with zxing-wasm, loaded from this origin only
// (copied to /vendor/zxing by scripts/copy-zxing.mjs). Module worker.
import { prepareZXingModule, readBarcodes } from "/vendor/zxing/es/reader/index.js";

const ready = prepareZXingModule({
  overrides: {
    // The package defaults to a third-party URL: always serve the .wasm from this origin.
    locateFile: (path, prefix) => (path.endsWith(".wasm") ? "/vendor/zxing/reader/zxing_reader.wasm" : prefix + path),
  },
  fireImmediately: true,
});

ready.catch(() => {}); // handled per message below

self.onmessage = async (e) => {
  const { id, image } = e.data;
  try {
    await ready;
  } catch {
    // zxing/wasm failed to initialize: distinct from "no QR found"
    self.postMessage({ id, text: null, error: true });
    return;
  }
  try {
    const [hit] = await readBarcodes(image, { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 1 });
    self.postMessage({ id, text: hit && hit.isValid ? hit.text : null });
  } catch {
    self.postMessage({ id, text: null });
  }
};
