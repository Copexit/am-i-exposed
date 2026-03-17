#!/usr/bin/env node

/**
 * validate-entity-data.mjs
 *
 * Reads entity index binary headers and validates address counts
 * haven't dropped below minimum thresholds. Used as a safety gate
 * before committing auto-updated entity data.
 */

import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "public", "data");

// Minimum acceptable address counts (safety floor)
const THRESHOLDS = {
  "entity-index.bin": 500_000,
  "entity-index-full.bin": 5_000_000,
};

function readEidxHeader(filePath) {
  const buf = readFileSync(filePath);
  // EIDX format: magic(4) + version(4) + entryCount(4) + nameCount(2) + ...
  const magic = buf.toString("utf-8", 0, 4);
  if (magic !== "EIDX") {
    throw new Error(`Invalid magic: ${magic} (expected EIDX)`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const version = view.getUint32(4, true);
  const entryCount = view.getUint32(8, true);
  const nameCount = view.getUint16(12, true);
  return { version, entryCount, nameCount };
}

function readBloomHeader(filePath) {
  const buf = readFileSync(filePath);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const version = view.getUint32(0, true);
  const addressCount = view.getUint32(4, true);
  return { version, addressCount };
}

let ok = true;

for (const [file, minCount] of Object.entries(THRESHOLDS)) {
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) {
    console.error(`FAIL: ${file} does not exist`);
    ok = false;
    continue;
  }

  try {
    const { entryCount, nameCount } = readEidxHeader(path);
    console.log(`${file}: ${entryCount.toLocaleString()} entries, ${nameCount} entities`);

    if (entryCount < minCount) {
      console.error(`FAIL: ${file} has ${entryCount} entries, minimum is ${minCount.toLocaleString()}`);
      ok = false;
    }
  } catch (err) {
    console.error(`FAIL: ${file} - ${err.message}`);
    ok = false;
  }
}

// Also validate bloom filters exist and have non-zero counts
for (const file of ["entity-filter.bin", "entity-filter-full.bin"]) {
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) {
    console.error(`FAIL: ${file} does not exist`);
    ok = false;
    continue;
  }

  try {
    const { version, addressCount } = readBloomHeader(path);
    console.log(`${file}: v${version}, ${addressCount.toLocaleString()} addresses`);

    if (addressCount === 0) {
      console.error(`FAIL: ${file} has 0 addresses`);
      ok = false;
    }
  } catch (err) {
    console.error(`FAIL: ${file} - ${err.message}`);
    ok = false;
  }
}

if (ok) {
  console.log("\nAll entity data files validated successfully.");
} else {
  console.error("\nEntity data validation FAILED. Aborting.");
  process.exit(1);
}
