#!/usr/bin/env node

/**
 * enrich-entity-samples.mjs
 *
 * Reads CSV source files (curated, custom, maru92) and adds a `sampleAddresses`
 * field to each entity in entities.json. Up to 3 addresses per entity,
 * preferring address-type diversity (bc1..., 3..., 1...).
 *
 * Usage: node scripts/enrich-entity-samples.mjs
 */

import { readFileSync, writeFileSync, readdirSync, createReadStream } from "fs";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { dirname, join, basename } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const ENTITIES_PATH = join(ROOT, "src/data/entities.json");
const CACHE_DIR = join(ROOT, ".cache/entity-data");

const MAX_SAMPLES = 3;

// ─── Helpers (shared logic with build-entity-filter.mjs) ─────────

function normalizeAddress(addr) {
  if (addr.startsWith("bc1") || addr.startsWith("tb1")) return addr.toLowerCase();
  return addr;
}

function isValidAddress(addr) {
  if (!addr || addr.length < 26 || addr.length > 90) return false;
  return /^(1|3|bc1|tb1)/.test(addr);
}

function normalizeEntityForLookup(name) {
  return name
    .toLowerCase()
    .replace(/\.(com|net|org|io|eu|ag|me|info|st|co\.in|com\.br|com\.au|in\.th)$/, "")
    .replace(/market(place)?$/, "")
    .trim();
}

function buildEntityLookup(entitiesJson) {
  const lookup = new Map();
  for (const e of entitiesJson.entities || []) {
    const canonical = e.name.toLowerCase();
    lookup.set(canonical, e.name);
    const stripped = canonical.replace(/\s*\(.*\)$/, "").replace(/\s+/g, "");
    if (stripped !== canonical) lookup.set(stripped, e.name);
  }
  return lookup;
}

function resolveEntityName(rawName, entityLookup) {
  const lower = rawName.toLowerCase();
  if (entityLookup.has(lower)) return entityLookup.get(lower);
  const normalized = normalizeEntityForLookup(rawName);
  if (entityLookup.has(normalized)) return entityLookup.get(normalized);
  return null; // Only return canonical names, skip unknowns
}

function findCsvFiles(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".csv"))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/** Get the address type bucket for diversity selection. */
function addrType(addr) {
  if (addr.startsWith("bc1")) return "bc1";
  if (addr.startsWith("3")) return "3";
  if (addr.startsWith("1")) return "1";
  return "other";
}

// ─── CSV streaming: collect sample addresses per entity ──────────

async function collectSamples(csvPath, entityLookup, samples) {
  const stream = createReadStream(csvPath, "utf-8");
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let headerDetected = false;
  let addrIdx = 0;
  let entityIdx = -1;

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));

    if (!headerDetected) {
      headerDetected = true;
      const lower = parts.map((c) => c.toLowerCase());
      const hasHeader = lower.some((c) =>
        ["hashadd", "address", "addr", "exchange", "gambling",
         "mining", "service", "historic", "entity", "label"].includes(c),
      );
      if (hasHeader) {
        addrIdx = lower.findIndex((c) =>
          ["hashadd", "address", "addr", "bitcoin_address"].includes(c),
        );
        entityIdx = lower.findIndex((c) =>
          ["entity", "label", "name", "wallet", "owner",
           "exchange", "gambling", "mining", "service", "historic"].includes(c),
        );
        if (addrIdx < 0) addrIdx = 0;
        continue;
      }
    }

    if (parts.length === 0 || !parts[0]) continue;

    const rawAddr = parts[addrIdx] || parts[0];
    const address = normalizeAddress(rawAddr);
    if (!isValidAddress(address)) continue;

    if (entityIdx < 0 || entityIdx >= parts.length) continue;
    const rawEntityName = parts[entityIdx];
    if (!rawEntityName || rawEntityName.toLowerCase() === "unknown") continue;

    const resolved = resolveEntityName(rawEntityName, entityLookup);
    if (!resolved) continue;

    // Get or create sample set for this entity
    if (!samples.has(resolved)) samples.set(resolved, []);
    const arr = samples.get(resolved);
    if (arr.length >= MAX_SAMPLES) continue;
    if (arr.includes(address)) continue;

    // Prefer address-type diversity: prioritize unfilled type buckets
    const type = addrType(address);
    const existingTypes = new Set(arr.map(addrType));
    if (!existingTypes.has(type)) {
      // New type - always add
      arr.push(address);
    } else if (arr.length < MAX_SAMPLES && existingTypes.size >= 3) {
      // All types filled, just fill remaining slots
      arr.push(address);
    }
    // Otherwise skip - wait for a different address type
  }
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  console.log("=== Enriching entities.json with sample addresses ===\n");

  const entitiesJson = JSON.parse(readFileSync(ENTITIES_PATH, "utf-8"));
  const entityLookup = buildEntityLookup(entitiesJson);
  const entityNames = new Set(entitiesJson.entities.map((e) => e.name));

  const samples = new Map(); // canonicalName -> string[]

  // Process CSVs in quality order: curated > custom > maru92
  const curatedCsvs = findCsvFiles(join(CACHE_DIR, "curated"));
  const customCsvs = findCsvFiles(join(CACHE_DIR, "custom"));
  const maru92Csvs = findCsvFiles(join(CACHE_DIR, "maru92"));

  for (const csvPath of curatedCsvs) {
    console.log(`  [Curated] ${basename(csvPath)}`);
    await collectSamples(csvPath, entityLookup, samples);
  }
  for (const csvPath of customCsvs) {
    console.log(`  [Custom] ${basename(csvPath)}`);
    await collectSamples(csvPath, entityLookup, samples);
  }
  for (const csvPath of maru92Csvs) {
    console.log(`  [Maru92] ${basename(csvPath)}`);
    await collectSamples(csvPath, entityLookup, samples);
  }

  // Enrich entities.json
  let enriched = 0;
  for (const entity of entitiesJson.entities) {
    const addrs = samples.get(entity.name);
    if (addrs && addrs.length > 0) {
      entity.sampleAddresses = addrs.slice(0, MAX_SAMPLES);
      enriched++;
    } else {
      // Remove stale sampleAddresses if any
      delete entity.sampleAddresses;
    }
  }

  writeFileSync(ENTITIES_PATH, JSON.stringify(entitiesJson, null, 2) + "\n", "utf-8");

  console.log(`\n  Enriched ${enriched}/${entityNames.size} entities with sample addresses`);
  console.log(`  Entities without samples: ${entityNames.size - enriched}`);

  // Show top entities
  const topEntities = entitiesJson.entities
    .filter((e) => e.sampleAddresses)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    .slice(0, 10);
  console.log("\n  Top entities:");
  for (const e of topEntities) {
    console.log(`    ${e.name} (${e.category}, p${e.priority}): ${e.sampleAddresses.length} addresses`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
