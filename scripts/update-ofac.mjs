#!/usr/bin/env node

/**
 * Fetches the latest OFAC-sanctioned Bitcoin addresses from
 * https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses
 * and writes them to src/data/ofac-addresses.json.
 *
 * Then cross-references OFAC addresses against Maru92 entity CSVs
 * to set ofac flags on matching entities in entities.json.
 *
 * Run: node scripts/update-ofac.mjs
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, createReadStream } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, basename } from "path";
import { createInterface } from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, "..", "src", "data", "ofac-addresses.json");
const ENTITIES_PATH = join(__dirname, "..", "src", "data", "entities.json");
const MARU92_DIR = join(__dirname, "..", ".cache", "entity-data", "maru92");

const OFAC_URL =
  "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_XBT.json";

// Fallback: known OFAC-sanctioned entities derived from public US Treasury designations.
// Used when Maru92 CSVs are not cached locally.
const KNOWN_OFAC_ENTITIES = [
  "Silk Road",
  "Hydra",
  "Tornado Cash",
  "Garantex",
  "Lazarus Group",
  "Chipmixer",
  "Sinbad",
  "Blender.io",
  "Suex",
  "Chatex",
  "BTC-e",
  "AlphaBay",
  "BLNK Financial",
  "Conti Ransomware",
  "Bitzlato",
];

/**
 * Stream a CSV file line-by-line, checking each address against the OFAC set.
 * Returns true as soon as any address is found in the set (short-circuits).
 */
async function csvHasOfacAddress(csvPath, ofacSet) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: createReadStream(csvPath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    let found = false;
    rl.on("line", (line) => {
      const addr = line.trim();
      if (!addr || addr.startsWith("#")) return;
      if (ofacSet.has(addr)) {
        found = true;
        rl.close();
      }
    });
    rl.on("close", () => resolve(found));
    rl.on("error", () => resolve(false));
  });
}

/**
 * Cross-reference OFAC addresses with Maru92 CSVs to find which entities
 * have OFAC-listed addresses. Returns a Set of entity names (from filenames).
 */
async function findOfacEntitiesFromMaru92(ofacSet) {
  if (!existsSync(MARU92_DIR)) return null;

  const files = readdirSync(MARU92_DIR).filter((f) => f.endsWith(".csv"));
  if (files.length === 0) return null;

  console.log(`Scanning ${files.length} Maru92 CSVs for OFAC address matches...`);
  const matched = new Set();

  for (const file of files) {
    const entityName = basename(file, ".csv");
    const hasMatch = await csvHasOfacAddress(join(MARU92_DIR, file), ofacSet);
    if (hasMatch) {
      matched.add(entityName);
      console.log(`  OFAC match: ${entityName}`);
    }
  }

  return matched;
}

async function main() {
  // Step 1: Fetch OFAC addresses
  console.log("Fetching OFAC sanctioned Bitcoin addresses...");

  const res = await fetch(OFAC_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
  }

  const addresses = await res.json();
  const ofacSet = new Set(addresses);

  const output = {
    lastUpdated: new Date().toISOString().split("T")[0],
    addresses,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(`Wrote ${addresses.length} addresses to ${OUTPUT_PATH}`);

  // Step 2: Cross-reference with entity data to set ofac flags
  console.log("\nUpdating entity OFAC flags in entities.json...");

  const entitiesData = JSON.parse(readFileSync(ENTITIES_PATH, "utf8"));
  const entities = entitiesData.entities;

  // Build name map for matching (lowercase -> entity object)
  const nameMap = new Map();
  for (const e of entities) {
    nameMap.set(e.name.toLowerCase(), e);
  }

  // Reset all OFAC flags first
  let previousOfacCount = 0;
  for (const e of entities) {
    if (e.ofac) previousOfacCount++;
    e.ofac = false;
  }

  // Try Maru92 CSVs first
  const maru92Matches = await findOfacEntitiesFromMaru92(ofacSet);

  let flaggedCount = 0;

  if (maru92Matches !== null) {
    // Use Maru92-derived matches
    for (const entityName of maru92Matches) {
      const entity = nameMap.get(entityName.toLowerCase());
      if (entity) {
        entity.ofac = true;
        flaggedCount++;
      } else {
        console.log(`  Warning: matched entity "${entityName}" not found in entities.json`);
      }
    }
    console.log(`\nSet ofac=true on ${flaggedCount} entities (from Maru92 CSV cross-reference)`);
  } else {
    // Fallback: use hardcoded known OFAC entities
    console.log("\nWarning: Maru92 CSVs not found in .cache/entity-data/maru92/");
    console.log("Using hardcoded KNOWN_OFAC_ENTITIES fallback.");
    console.log("Run the entity data download script for accurate cross-referencing.\n");

    for (const name of KNOWN_OFAC_ENTITIES) {
      const entity = nameMap.get(name.toLowerCase());
      if (entity) {
        entity.ofac = true;
        flaggedCount++;
        console.log(`  Flagged: ${name}`);
      } else {
        console.log(`  Skipped (not in entities.json): ${name}`);
      }
    }
    console.log(`\nSet ofac=true on ${flaggedCount} entities (from hardcoded fallback)`);
  }

  // Write updated entities.json
  writeFileSync(ENTITIES_PATH, JSON.stringify(entitiesData, null, 2) + "\n");
  console.log(`Previous OFAC entities: ${previousOfacCount}, now: ${flaggedCount}`);
  console.log("Done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
