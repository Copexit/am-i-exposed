#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/../boltzmann-rs"

echo "Building boltzmann-rs WASM..."
wasm-pack build --target web --release --out-dir ../public/wasm/boltzmann

# Clean up unnecessary files
rm -f ../public/wasm/boltzmann/.gitignore ../public/wasm/boltzmann/package.json

echo "WASM build complete. Output in public/wasm/boltzmann/"
ls -lh ../public/wasm/boltzmann/
