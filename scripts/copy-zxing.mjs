// Copies the zxing-wasm reader build into public/vendor/zxing (served same-origin, never from a CDN).
// Layout kept as in the package so the relative import "../share.js" resolves:
//   es/reader/index.js, es/share.js, reader/zxing_reader.wasm
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

// The package's "exports" hides package.json, so resolve via node_modules directly.
const pkgDir = join(process.cwd(), "node_modules/zxing-wasm");
const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8")).version;
const out = join(process.cwd(), "public/vendor/zxing");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const p of ["es/reader/index.js", "es/share.js", "reader/zxing_reader.wasm"]) {
  mkdirSync(dirname(join(out, p)), { recursive: true });
  cpSync(join(pkgDir, "dist", p), join(out, p));
}
console.log(`zxing-wasm ${version} copied to public/vendor/zxing`);
