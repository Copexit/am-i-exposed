// QR decoding off the main thread with zxing-wasm, loaded from this origin only
// (copied to /vendor/zxing by scripts/copy-zxing.mjs). Module worker.
import { prepareZXingModule, readBarcodes } from "/vendor/zxing/es/reader/index.js";

prepareZXingModule({
  overrides: {
    // The package defaults to a third-party URL: always serve the .wasm from this origin.
    locateFile: (path, prefix) => (path.endsWith(".wasm") ? "/vendor/zxing/reader/zxing_reader.wasm" : prefix + path),
  },
  fireImmediately: true,
});

self.onmessage = async (e) => {
  const { id, image } = e.data;
  try {
    const [hit] = await readBarcodes(image, { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 1 });
    self.postMessage({ id, text: hit && hit.isValid ? hit.text : null });
  } catch {
    self.postMessage({ id, text: null });
  }
};
