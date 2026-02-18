#!/usr/bin/env node

/**
 * Fetches the latest OFAC-sanctioned Bitcoin addresses from
 * https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses
 * and writes them to src/data/ofac-addresses.json.
 *
 * Run: node scripts/update-ofac.mjs
 */

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, "..", "src", "data", "ofac-addresses.json");

const URL =
  "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_XBT.json";

async function main() {
  console.log("Fetching OFAC sanctioned Bitcoin addresses...");

  const res = await fetch(URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
  }

  const addresses = await res.json();

  const output = {
    lastUpdated: new Date().toISOString().split("T")[0],
    addresses,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(`Wrote ${addresses.length} addresses to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
