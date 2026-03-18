/**
 * Bundle the CLI into a single distributable file using esbuild.
 *
 * Resolves @/ path aliases, bundles all src/lib/ code, and externalizes
 * Node.js builtins + crypto libraries that have native/WASM components.
 */

import { build } from "esbuild";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(__dirname, "src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: resolve(__dirname, "dist/index.js"),
  // Resolve @/ alias to ../src/
  alias: {
    "@": resolve(__dirname, "..", "src"),
  },
  // Don't bundle these - they're npm dependencies or have native components
  external: [
    "commander",
    "chalk",
    "ora",
    "@noble/curves",
    "@noble/hashes",
    "@scure/base",
    "@scure/bip32",
    "@scure/btc-signer",
    "better-sqlite3",
  ],
  // Banner with shebang for CLI binary
  banner: {
    js: "#!/usr/bin/env node",
  },
  // Silence import.meta warnings - we handle fallback to __dirname in source
  logOverride: {
    "empty-import-meta": "silent",
  },
  // Source maps for debugging
  sourcemap: true,
  // Minify for smaller package
  minify: false,
  // Keep readable for debugging
  keepNames: true,
});

console.log("CLI built successfully -> cli/dist/index.js");
