#!/usr/bin/env node

/**
 * build-entity-filter.mjs
 *
 * Downloads Bitcoin entity address datasets, merges them, and compiles a
 * Bloom filter binary for the am-i.exposed privacy scanner.
 *
 * Sources:
 *   1. Maru92/EntityAddressBitcoin  - 30.3M labeled addresses (CC license)
 *   2. BitcoinTemporalGraph         - 100K labeled addresses (CC-BY 4.0)
 *   3. OFAC sanctioned addresses    - ~520 addresses (already in repo)
 *   4. WalletExplorer API           - optional, rate-limited
 *
 * Output: public/data/entity-filter.bin (Bloom filter, binary version 2)
 *
 * Usage:
 *   # Download Maru92 dataset + build filter
 *   node scripts/build-entity-filter.mjs --download
 *
 *   # Build from cached data (subsequent runs)
 *   node scripts/build-entity-filter.mjs
 *
 *   # Build with WalletExplorer enrichment (slow, rate-limited)
 *   node scripts/build-entity-filter.mjs --walletexplorer
 *
 *   # Build from only OFAC data (no external downloads)
 *   node scripts/build-entity-filter.mjs --ofac-only
 *
 *   # Custom FPR and address limit
 *   node scripts/build-entity-filter.mjs --fpr=0.001 --max=1000000
 *
 * Manual data download (if --download fails):
 *   1. Download the ZIP from https://drive.switch.ch/index.php/s/ag4OnNgwf7LhWFu
 *   2. Extract to .cache/entity-data/maru92/
 *   CSV columns: hashAdd, date_first_tx, {exchange|gambling|...}, add_type, add_num
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  createReadStream,
} from "fs";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { dirname, join, basename } from "path";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CACHE_DIR = join(ROOT, ".cache", "entity-data");
const OUTPUT_DIR = join(ROOT, "public", "data");
const OFAC_PATH = join(ROOT, "src", "data", "ofac-addresses.json");
const ENTITIES_PATH = join(ROOT, "src", "data", "entities.json");

// WalletExplorer API config (adapted from enrich_entities.py)
const WE_CALLER = "semilla_bitcoin";
const WE_DELAY_MS = 1200;
const WE_TIMEOUT_MS = 10_000;

// Bloom filter hash seeds (FNV-1a with independent seeds)
const FNV_SEED_1 = 2166136261; // standard FNV-1a offset basis
const FNV_SEED_2 = 2654435761; // golden ratio constant (0x9E3779B1)

const MARU92_ZIP_URL =
  "https://drive.switch.ch/index.php/s/ag4OnNgwf7LhWFu/download";

// ───────────────── Standalone hash function ─────────────────

/** FNV-1a 32-bit hash with configurable seed (standalone version). */
function fnv1aHash(key, seed) {
  let h = seed;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ───────────────── Bloom filter implementation ─────────────────

class BloomFilter {
  /**
   * @param {number} n - expected number of elements
   * @param {number} fpr - desired false positive rate (e.g. 0.001)
   */
  constructor(n, fpr = 0.001) {
    this.n = n;
    this.fpr = fpr;
    this.m = Math.ceil((-n * Math.log(fpr)) / (Math.LN2 * Math.LN2));
    this.k = Math.max(1, Math.ceil((this.m / n) * Math.LN2));
    this.bits = new Uint8Array(Math.ceil(this.m / 8));
    this.count = 0;
  }

  _fnv1a(key, seed) {
    let h = seed;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  _positions(key) {
    const h1 = this._fnv1a(key, FNV_SEED_1);
    const h2 = this._fnv1a(key, FNV_SEED_2);
    const positions = new Array(this.k);
    for (let i = 0; i < this.k; i++) {
      positions[i] = (h1 + i * h2) % this.m;
    }
    return positions;
  }

  add(key) {
    for (const pos of this._positions(key)) {
      this.bits[pos >> 3] |= 1 << (pos & 7);
    }
    this.count++;
  }

  has(key) {
    for (const pos of this._positions(key)) {
      if (!(this.bits[pos >> 3] & (1 << (pos & 7)))) return false;
    }
    return true;
  }

  /**
   * Serialize to the version-2 binary format.
   *
   * Layout:
   *   Header  (32 bytes): version(4) addressCount(4) fprX1000(4) dateLen(4) date(16)
   *   Bloom   (16 bytes): m(4) k(4) seed1(4) seed2(4)
   *   Payload (ceil(m/8) bytes): bit array
   */
  serialize() {
    const buildDate = new Date().toISOString().slice(0, 16);
    const dateBytes = new TextEncoder().encode(buildDate);

    const header = new ArrayBuffer(32);
    const hView = new DataView(header);
    hView.setUint32(0, 2, true);
    hView.setUint32(4, this.count, true);
    hView.setUint32(8, Math.round(this.fpr * 1000), true);
    hView.setUint32(12, dateBytes.length, true);
    new Uint8Array(header, 16, dateBytes.length).set(dateBytes);

    const params = new ArrayBuffer(16);
    const pView = new DataView(params);
    pView.setUint32(0, this.m, true);
    pView.setUint32(4, this.k, true);
    pView.setUint32(8, FNV_SEED_1, true);
    pView.setUint32(12, FNV_SEED_2, true);

    const total = 32 + 16 + this.bits.length;
    const result = new Uint8Array(total);
    result.set(new Uint8Array(header), 0);
    result.set(new Uint8Array(params), 32);
    result.set(this.bits, 48);
    return result;
  }
}

// ───────────────── CLI ─────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const getFlag = (name) => args.includes(name);
  const getValue = (name) => {
    const arg = args.find((a) => a.startsWith(`${name}=`));
    return arg ? arg.split("=")[1] : undefined;
  };
  return {
    download: getFlag("--download"),
    ofacOnly: getFlag("--ofac-only"),
    walletexplorer: getFlag("--walletexplorer"),
    full: getFlag("--full"),
    fpr: parseFloat(getValue("--fpr") || "0.001"),
    maxAddresses: parseInt(getValue("--max") || "0") || 0,
    indexMax: parseInt(getValue("--index-max") || "10000000") || 10_000_000,
    output: getValue("--output") || "entity-filter.bin",
    help: getFlag("--help") || getFlag("-h"),
  };
}

// ───────────────── Helpers ─────────────────

/** Recursively find all CSV files under a directory. */
function findCsvFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== ".git") {
      results.push(...findCsvFiles(fullPath));
    } else if (entry.name.toLowerCase().endsWith(".csv")) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Infer entity category from CSV filename. */
function getCategoryFromFilename(filename) {
  const lower = filename.toLowerCase();
  if (lower.startsWith("exchange")) return "exchange";
  if (lower.startsWith("mining")) return "mining";
  if (lower.startsWith("gambling")) return "gambling";
  if (lower.startsWith("service")) return "payment";
  if (lower.startsWith("historic")) return "historical";
  if (lower.startsWith("darknet")) return "darknet";
  if (lower.startsWith("scam")) return "scam";
  if (lower.startsWith("mixer")) return "mixer";
  return "unknown";
}

/**
 * Normalize a Maru92 domain-style entity name to match entities.json display names.
 * e.g. "bittrex.com" -> "bittrex", "silkroadmarketplace" -> "silk road"
 */
function normalizeEntityForLookup(name) {
  return name
    .toLowerCase()
    .replace(
      /\.(com|net|org|io|eu|ag|me|info|st|co\.in|com\.br|com\.au|in\.th)$/,
      "",
    )
    .replace(/market(place)?$/, "")
    .trim();
}

/**
 * Build a lookup map from normalized entity names in entities.json
 * to their canonical display names. Handles domain-style names from Maru92.
 */
function buildEntityLookup(entitiesJson) {
  const lookup = new Map();
  for (const e of entitiesJson.entities || []) {
    const canonical = e.name.toLowerCase();
    lookup.set(canonical, e.name);
    // Also add normalized form (strip parenthetical suffixes)
    const stripped = canonical
      .replace(/\s*\(.*\)$/, "")
      .replace(/\s+/g, "");
    if (stripped !== canonical) lookup.set(stripped, e.name);
  }
  return lookup;
}

/**
 * Resolve a raw CSV entity name to a canonical display name.
 * Cross-references with entities.json; falls back to TLD-stripped name.
 */
function resolveEntityName(rawName, entityLookup) {
  const lower = rawName.toLowerCase();
  if (entityLookup.has(lower)) return entityLookup.get(lower);
  const normalized = normalizeEntityForLookup(rawName);
  if (entityLookup.has(normalized)) return entityLookup.get(normalized);
  // Fallback: strip common TLDs
  return rawName
    .replace(
      /\.(com|net|org|io|eu|ag|me|info|st|co\.in|com\.br|com\.au|in\.th)$/i,
      "",
    )
    .trim();
}

/** Normalize a Bitcoin address for filter insertion. */
function normalizeAddress(addr) {
  if (addr.startsWith("bc1") || addr.startsWith("tb1")) return addr.toLowerCase();
  return addr;
}

/** Validate a Bitcoin address string. */
function isValidAddress(addr) {
  if (!addr || addr.length < 26 || addr.length > 90) return false;
  return /^(1|3|bc1|tb1)/.test(addr);
}

/** Count lines in a file quickly. */
function countLines(filePath) {
  try {
    const out = execSync(`wc -l < "${filePath}"`, { encoding: "utf-8" });
    return parseInt(out.trim()) || 0;
  } catch {
    return 0;
  }
}

// ───────────────── Streaming CSV loader ─────────────────

/**
 * Stream a CSV file directly into the Bloom filter.
 * Returns the number of new addresses added.
 *
 * Uses the filter itself for deduplication - if an address is already
 * in the filter, it's skipped. This gives ~99.9% accurate dedup at
 * 0.1% FPR with O(filter_size) memory instead of O(n_addresses).
 */
async function streamCsvIntoFilter(filePath, category, sourceName, filter, stats) {
  const stream = createReadStream(filePath, "utf-8");
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let lineNum = 0;
  let headerDetected = false;
  let addrIdx = 0;
  let entityIdx = -1;
  let added = 0;

  for await (const rawLine of rl) {
    // Check max limit
    if (stats.maxAddresses > 0 && stats.unique >= stats.maxAddresses) break;

    lineNum++;
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));

    // Header detection on first data line
    if (!headerDetected) {
      headerDetected = true;
      const lower = parts.map((c) => c.toLowerCase());

      const hasHeader = lower.some(
        (c) =>
          c === "hashadd" ||
          c === "address" ||
          c === "addr" ||
          c === "exchange" ||
          c === "gambling" ||
          c === "mining" ||
          c === "service" ||
          c === "historic" ||
          c === "entity" ||
          c === "label",
      );

      if (hasHeader) {
        addrIdx = lower.findIndex(
          (c) =>
            c === "hashadd" ||
            c === "address" ||
            c === "addr" ||
            c === "bitcoin_address",
        );
        entityIdx = lower.findIndex(
          (c) =>
            c === "entity" ||
            c === "label" ||
            c === "name" ||
            c === "wallet" ||
            c === "owner" ||
            c === "exchange" ||
            c === "gambling" ||
            c === "mining" ||
            c === "service" ||
            c === "historic",
        );
        if (addrIdx < 0) addrIdx = 0;
        continue;
      }
    }

    if (parts.length === 0 || !parts[0]) continue;

    const rawAddr = parts[addrIdx] || parts[0];
    const address = normalizeAddress(rawAddr);

    if (!isValidAddress(address)) continue;

    // Dedup using the filter itself (probabilistic but memory-efficient)
    if (!filter.has(address)) {
      filter.add(address);
      added++;
      stats.unique++;

      // In full mode: addresses beyond indexMax go into overflow Bloom only
      const pastIndexLimit = stats.indexMax > 0 && stats.unique > stats.indexMax;

      if (pastIndexLimit && stats.overflowFilter) {
        // Overflow: add to overflow Bloom (no name resolution)
        stats.overflowFilter.add(address);
        stats.overflowCount = (stats.overflowCount || 0) + 1;
      } else {
        // Within index limit: record entity mapping for the name index
        if (entityIdx >= 0 && entityIdx < parts.length) {
          const rawEntityName = parts[entityIdx];
          if (rawEntityName && rawEntityName.toLowerCase() !== "unknown") {
            const resolvedName = resolveEntityName(rawEntityName, stats.entityLookup);
            let eid = stats.entityNameMap.get(resolvedName);
            if (eid === undefined) {
              eid = stats.entityNameTable.length;
              stats.entityNameTable.push({ name: resolvedName, category });
              stats.entityNameMap.set(resolvedName, eid);
            }
            stats.entityIndex.push({ hash: fnv1aHash(address, FNV_SEED_1), entityId: eid });
          }
        }
      }
    }
    stats.total++;

    // Track entity name for cross-referencing
    if (entityIdx >= 0 && entityIdx < parts.length) {
      const entity = parts[entityIdx];
      if (entity) {
        stats.entityCounts[entity.toLowerCase()] =
          (stats.entityCounts[entity.toLowerCase()] || 0) + 1;
      }
    }

    // Track category and source counts
    stats.categories[category] = (stats.categories[category] || 0) + 1;
    stats.sources[sourceName] = (stats.sources[sourceName] || 0) + 1;

    // Progress every 1M lines
    if (lineNum % 1_000_000 === 0) {
      process.stdout.write(
        `    ${(lineNum / 1_000_000).toFixed(0)}M lines (${added.toLocaleString()} new)...\r`,
      );
    }
  }

  if (lineNum > 1_000_000) process.stdout.write("\n");
  return added;
}

// ───────────────── Download ─────────────────

function downloadMaru92() {
  const targetDir = join(CACHE_DIR, "maru92");

  if (existsSync(targetDir) && findCsvFiles(targetDir).length > 0) {
    console.log("  Maru92 already cached, skipping download");
    return true;
  }

  mkdirSync(targetDir, { recursive: true });
  const zipPath = join(CACHE_DIR, "maru92-download.zip");

  console.log("  Downloading Maru92 dataset from SWITCHdrive (~1 GB)...");
  console.log(`  URL: ${MARU92_ZIP_URL}`);

  try {
    execSync(`curl -L -o "${zipPath}" --progress-bar "${MARU92_ZIP_URL}"`, {
      stdio: "inherit",
      timeout: 600_000,
    });
    console.log("  Extracting ZIP...");
    execSync(`unzip -o -j "${zipPath}" "*.csv" -d "${targetDir}"`, {
      stdio: "inherit",
      timeout: 120_000,
    });
    execSync(`rm -f "${zipPath}"`);

    const csvCount = findCsvFiles(targetDir).length;
    console.log(`  Extracted ${csvCount} CSV files`);
    return csvCount > 0;
  } catch (err) {
    console.error(`  Download failed: ${err.message}`);
    console.error("  Manual download:");
    console.error(`    1. Download ZIP from: ${MARU92_ZIP_URL}`);
    console.error(`    2. Extract CSVs to: ${targetDir}`);
    return false;
  }
}

// ───────────────── WalletExplorer API ─────────────────

async function streamWalletExplorerIntoFilter(entities, filter, stats) {
  for (const entity of entities) {
    if (stats.maxAddresses > 0 && stats.unique >= stats.maxAddresses) break;

    const name = entity.name;
    process.stdout.write(`  WalletExplorer: "${name}"...`);

    try {
      const url =
        `https://www.walletexplorer.com/api/1/wallet-addresses` +
        `?wallet=${encodeURIComponent(name)}&caller=${WE_CALLER}&from=0&count=100`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), WE_TIMEOUT_MS);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        if (data.found && data.addresses) {
          const addrs = Array.isArray(data.addresses)
            ? data.addresses
            : Object.keys(data.addresses);
          let added = 0;
          for (const addr of addrs) {
            const normalized = normalizeAddress(addr);
            if (!isValidAddress(normalized)) continue;
            if (!filter.has(normalized)) {
              filter.add(normalized);
              added++;
              stats.unique++;
            }
            stats.total++;
            stats.sources.walletexplorer =
              (stats.sources.walletexplorer || 0) + 1;
            stats.categories[entity.category || "exchange"] =
              (stats.categories[entity.category || "exchange"] || 0) + 1;
          }
          stats.entityCounts[name.toLowerCase()] =
            (stats.entityCounts[name.toLowerCase()] || 0) + addrs.length;
          console.log(
            ` ${added} new (${data.addresses_count || "?"} total in wallet)`,
          );
        } else {
          console.log(" not found");
        }
      } else {
        console.log(` HTTP ${res.status}`);
      }
    } catch (err) {
      console.log(` error: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, WE_DELAY_MS));
  }
}

// ───────────────── Entity index writer ─────────────────

// Category string -> byte encoding for the binary format
const CATEGORY_BYTE = {
  exchange: 0, darknet: 1, scam: 2, gambling: 3,
  payment: 4, mining: 5, mixer: 6, p2p: 7, unknown: 8,
  historical: 4, // historical -> payment (closest match)
  sanctioned: 0,  // sanctioned -> exchange (OFAC handles the flag)
};

/**
 * Write the entity name index binary.
 *
 * Format v2:
 *   Header (20 bytes): magic("EIDX",4) version(4) entryCount(4) nameCount(2) hashSeed(4) reserved(2)
 *   Name table: for each name: length(1) + UTF-8 bytes + category(1)
 *   Sorted index: for each entry: hash(4,LE) + entityId(2,LE)
 */
function writeEntityIndex(outputPath, entityNameTable, entityIndex) {
  // Sort entries by hash for binary search at runtime
  entityIndex.sort((a, b) => a.hash - b.hash);

  // Build name table bytes (v2: includes category byte per name)
  const encoder = new TextEncoder();
  const nameBuffers = entityNameTable.map((entry) => {
    const name = typeof entry === "string" ? entry : entry.name;
    const category = typeof entry === "string" ? "exchange" : entry.category;
    const nameBytes = encoder.encode(name);
    const buf = new Uint8Array(1 + nameBytes.length + 1);
    buf[0] = nameBytes.length;
    buf.set(nameBytes, 1);
    buf[1 + nameBytes.length] = CATEGORY_BYTE[category] ?? 0;
    return buf;
  });
  const nameTableSize = nameBuffers.reduce((s, b) => s + b.length, 0);

  const headerSize = 20;
  const indexSize = entityIndex.length * 6;
  const total = headerSize + nameTableSize + indexSize;

  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Header
  bytes[0] = 0x45; bytes[1] = 0x49; bytes[2] = 0x44; bytes[3] = 0x58; // "EIDX"
  view.setUint32(4, 2, true);                         // version (v2: name table includes category)
  view.setUint32(8, entityIndex.length, true);         // entryCount
  view.setUint16(12, entityNameTable.length, true);    // nameCount
  view.setUint32(14, FNV_SEED_1, true);                // hashSeed
  // bytes 18-19: reserved (0)

  // Name table
  let offset = headerSize;
  for (const buf of nameBuffers) {
    bytes.set(buf, offset);
    offset += buf.length;
  }

  // Sorted index entries
  for (const entry of entityIndex) {
    view.setUint32(offset, entry.hash, true);
    view.setUint16(offset + 4, entry.entityId, true);
    offset += 6;
  }

  writeFileSync(outputPath, new Uint8Array(buffer));
  return { total, nameCount: entityNameTable.length, entryCount: entityIndex.length };
}

// ───────────────── Main pipeline ─────────────────

async function main() {
  const opts = parseArgs();

  if (opts.help) {
    console.log(`
Usage: node scripts/build-entity-filter.mjs [options]

Options:
  --download        Download Maru92 dataset before building
  --ofac-only       Build filter from OFAC addresses only
  --walletexplorer  Query WalletExplorer API (slow, rate-limited)
  --full            Full build: 10M named index + overflow Bloom
  --fpr=0.001       False positive rate (default: 0.001 = 0.1%)
  --max=N           Limit total addresses (0 = unlimited)
  --index-max=N     Addresses in full index (default: 10000000)
  --output=NAME     Output filename (default: entity-filter.bin)
  --help, -h        Show this help

Build modes:
  # Core (1M addresses, index only)
  node scripts/build-entity-filter.mjs --max=1000000

  # Full (10M index + 20M overflow Bloom)
  node scripts/build-entity-filter.mjs --full --index-max=10000000

Data sources are cached in .cache/entity-data/.
Output: public/data/
`);
    return;
  }

  console.log("=== Entity Address Filter Build Pipeline ===\n");

  // ── Phase 1: Download (optional) ──
  if (opts.download) {
    console.log("[1/5] Downloading datasets...");
    downloadMaru92();
    console.log();
  }

  // ── Phase 2: Estimate total address count ──
  console.log("[2/5] Estimating dataset size...");

  let estimatedTotal = 0;

  // OFAC
  if (existsSync(OFAC_PATH)) {
    const ofac = JSON.parse(readFileSync(OFAC_PATH, "utf-8"));
    estimatedTotal += (ofac.addresses || []).length;
    console.log(`  OFAC: ${(ofac.addresses || []).length} addresses`);
  }

  // Maru92
  const maru92Dir = join(CACHE_DIR, "maru92");
  const maru92Csvs = !opts.ofacOnly ? findCsvFiles(maru92Dir) : [];
  if (maru92Csvs.length > 0) {
    // Sort: exchanges first (most valuable for privacy analysis)
    maru92Csvs.sort((a, b) => {
      const catA = getCategoryFromFilename(basename(a));
      const catB = getCategoryFromFilename(basename(b));
      const priority = {
        exchange: 0,
        mining: 1,
        gambling: 2,
        payment: 3,
        historical: 4,
      };
      return (priority[catA] ?? 5) - (priority[catB] ?? 5);
    });

    for (const csv of maru92Csvs) {
      const lines = countLines(csv);
      estimatedTotal += lines;
      console.log(
        `  ${basename(csv)}: ~${lines.toLocaleString()} lines`,
      );
    }
  }

  // Temporal
  const temporalDir = join(CACHE_DIR, "temporal");
  const temporalCsvs = !opts.ofacOnly ? findCsvFiles(temporalDir) : [];
  for (const csv of temporalCsvs) {
    const lines = countLines(csv);
    estimatedTotal += lines;
    console.log(`  ${basename(csv)}: ~${lines.toLocaleString()} lines`);
  }

  // Custom
  const customDir = join(CACHE_DIR, "custom");
  const customCsvs = !opts.ofacOnly ? findCsvFiles(customDir) : [];
  for (const csv of customCsvs) {
    const lines = countLines(csv);
    estimatedTotal += lines;
    console.log(`  ${basename(csv)}: ~${lines.toLocaleString()} lines`);
  }

  // Apply max
  const filterCapacity =
    opts.maxAddresses > 0
      ? Math.min(estimatedTotal, opts.maxAddresses)
      : estimatedTotal;

  if (filterCapacity === 0) {
    console.error("\nNo data sources found. Use --download or --ofac-only.");
    process.exit(1);
  }

  console.log(`\n  Estimated total: ${estimatedTotal.toLocaleString()}`);
  console.log(`  Filter capacity: ${filterCapacity.toLocaleString()}\n`);

  // ── Phase 3: Create filter and stream addresses ──
  console.log("[3/6] Building Bloom filter (streaming)...\n");

  const filter = new BloomFilter(filterCapacity, opts.fpr);
  console.log(`  Bloom bits (m): ${filter.m.toLocaleString()}`);
  console.log(`  Hash functions (k): ${filter.k}`);
  console.log(
    `  Filter memory: ${(filter.bits.length / 1024 / 1024).toFixed(1)} MB\n`,
  );

  // Pre-build entity lookup for resolving CSV names to canonical display names
  const entitiesJsonEarly = JSON.parse(readFileSync(ENTITIES_PATH, "utf-8"));
  const entityLookupEarly = buildEntityLookup(entitiesJsonEarly);

  // In --full mode, create an overflow Bloom for addresses beyond indexMax
  let overflowFilter = null;
  if (opts.full) {
    const overflowCapacity = Math.max(filterCapacity - opts.indexMax, 1_000_000);
    overflowFilter = new BloomFilter(overflowCapacity, opts.fpr);
    console.log(`  Full mode: first ${opts.indexMax.toLocaleString()} -> index, rest -> overflow Bloom`);
    console.log(`  Overflow Bloom capacity: ${overflowCapacity.toLocaleString()}`);
    console.log(`  Overflow Bloom memory: ${(overflowFilter.bits.length / 1024 / 1024).toFixed(1)} MB\n`);
  }

  const stats = {
    total: 0,
    unique: 0,
    maxAddresses: opts.maxAddresses,
    indexMax: opts.full ? opts.indexMax : 0, // 0 means no overflow splitting
    overflowFilter,
    overflowCount: 0,
    entityCounts: {},
    categories: {},
    sources: {},
    sampleAddresses: [], // small sample for verification
    // Entity name index (Phase 1: address -> entity name mapping)
    entityLookup: entityLookupEarly,
    entityIndex: [],       // Array<{ hash: number, entityId: number }>
    entityNameTable: [],   // Canonical entity names (index = ID)
    entityNameMap: new Map(), // resolvedName -> entityId
  };

  // Source 1: OFAC (highest priority)
  console.log("  [OFAC] sanctioned addresses");
  if (existsSync(OFAC_PATH)) {
    const ofac = JSON.parse(readFileSync(OFAC_PATH, "utf-8"));
    for (const addr of ofac.addresses || []) {
      const normalized = normalizeAddress(addr);
      if (!isValidAddress(normalized)) continue;
      if (!filter.has(normalized)) {
        filter.add(normalized);
        stats.unique++;
        if (stats.sampleAddresses.length < 100) {
          stats.sampleAddresses.push(normalized);
        }
      }
      stats.total++;
      stats.sources.ofac = (stats.sources.ofac || 0) + 1;
      stats.categories.sanctioned = (stats.categories.sanctioned || 0) + 1;
    }
    console.log(
      `    ${stats.unique} unique from ${(ofac.addresses || []).length} total\n`,
    );
  }

  if (!opts.ofacOnly) {
    // Source 2: Maru92 CSVs (sorted by priority)
    for (const csvPath of maru92Csvs) {
      if (opts.maxAddresses > 0 && stats.unique >= opts.maxAddresses) break;

      const fname = basename(csvPath, ".csv");
      const category = getCategoryFromFilename(fname);
      console.log(`  [Maru92] ${fname} (${category})`);

      const prevUnique = stats.unique;
      const added = await streamCsvIntoFilter(
        csvPath,
        category,
        "maru92",
        filter,
        stats,
      );
      console.log(
        `    ${added.toLocaleString()} new addresses (${stats.unique.toLocaleString()} total unique)\n`,
      );

      // Collect sample addresses for verification
      if (stats.sampleAddresses.length < 100 && added > 0) {
        // Read a few addresses from the beginning of the file for spot checks
        const sampleStream = createReadStream(csvPath, "utf-8");
        const sampleRl = createInterface({ input: sampleStream, crlfDelay: Infinity });
        let sampled = 0;
        let isFirst = true;
        for await (const line of sampleRl) {
          if (isFirst) { isFirst = false; continue; } // skip header
          if (sampled >= 20) break;
          const parts = line.split(",");
          // hashAdd is the last column in Maru92 format
          const addr = parts[parts.length - 1]?.trim().replace(/^"|"$/g, "");
          if (addr && isValidAddress(addr)) {
            stats.sampleAddresses.push(normalizeAddress(addr));
            sampled++;
          }
        }
        sampleRl.close();
      }
    }

    // Source 3: BitcoinTemporalGraph
    for (const csvPath of temporalCsvs) {
      if (opts.maxAddresses > 0 && stats.unique >= opts.maxAddresses) break;
      const fname = basename(csvPath, ".csv");
      console.log(`  [Temporal] ${fname}`);
      const added = await streamCsvIntoFilter(
        csvPath,
        "unknown",
        "temporal",
        filter,
        stats,
      );
      console.log(`    ${added.toLocaleString()} new\n`);
    }

    // Source 4: Custom CSVs
    for (const csvPath of customCsvs) {
      if (opts.maxAddresses > 0 && stats.unique >= opts.maxAddresses) break;
      const fname = basename(csvPath, ".csv");
      console.log(`  [Custom] ${fname}`);
      const added = await streamCsvIntoFilter(
        csvPath,
        "unknown",
        "custom",
        filter,
        stats,
      );
      console.log(`    ${added.toLocaleString()} new\n`);
    }

    // Source 5: WalletExplorer API (optional, slow)
    if (opts.walletexplorer) {
      console.log("  [WalletExplorer] API queries");
      const entitiesJson = JSON.parse(readFileSync(ENTITIES_PATH, "utf-8"));
      await streamWalletExplorerIntoFilter(
        entitiesJson.entities || [],
        filter,
        stats,
      );
      console.log();
    }
  }

  // ── Phase 4: Verify and cross-reference ──
  console.log("[4/6] Verifying filter...");

  // Spot-check: all sample addresses must be in the filter
  let falseNegatives = 0;
  for (const addr of stats.sampleAddresses) {
    if (!filter.has(addr)) falseNegatives++;
  }
  if (falseNegatives > 0) {
    console.error(
      `  FATAL: ${falseNegatives}/${stats.sampleAddresses.length} false negatives!`,
    );
    process.exit(1);
  }
  console.log(
    `  ${stats.sampleAddresses.length} spot checks passed (0 false negatives)`,
  );

  // Cross-reference with entities.json using normalized names
  const entitiesJson = JSON.parse(readFileSync(ENTITIES_PATH, "utf-8"));
  const entityLookup = buildEntityLookup(entitiesJson);

  let matchCount = 0;
  const unmatchedEntities = [];
  for (const [rawName, count] of Object.entries(stats.entityCounts)) {
    if (!rawName || rawName === "unknown") continue;
    const normalized = normalizeEntityForLookup(rawName);
    if (entityLookup.has(rawName) || entityLookup.has(normalized)) {
      matchCount++;
    } else {
      unmatchedEntities.push([rawName, count]);
    }
  }
  unmatchedEntities.sort((a, b) => b[1] - a[1]);

  console.log(`  ${matchCount} entities match entities.json (with normalization)`);
  if (unmatchedEntities.length > 0) {
    console.log(
      `  ${unmatchedEntities.length} entities NOT in entities.json. Top 15:`,
    );
    for (const [name, count] of unmatchedEntities.slice(0, 15)) {
      console.log(`    - ${name} (${count.toLocaleString()} addresses)`);
    }
  }
  console.log();

  // ── Phase 5: Write output files ──
  mkdirSync(OUTPUT_DIR, { recursive: true });

  if (opts.full) {
    // Full mode: write entity-index-full.bin + entity-filter-full.bin
    console.log("[5/6] Writing full entity index...");
    if (stats.entityIndex.length > 0) {
      const indexPath = join(OUTPUT_DIR, "entity-index-full.bin");
      const indexInfo = writeEntityIndex(indexPath, stats.entityNameTable, stats.entityIndex);
      const indexSizeMB = indexInfo.total / 1024 / 1024;
      console.log(`  Output: ${indexPath}`);
      console.log(`  Size: ${indexSizeMB.toFixed(2)} MB`);
      console.log(`  Entities: ${indexInfo.nameCount}`);
      console.log(`  Address mappings: ${indexInfo.entryCount.toLocaleString()}\n`);
    }

    console.log("[6/6] Writing overflow Bloom filter...");
    if (overflowFilter && stats.overflowCount > 0) {
      const bloomBinary = overflowFilter.serialize();
      const bloomPath = join(OUTPUT_DIR, "entity-filter-full.bin");
      writeFileSync(bloomPath, bloomBinary);
      const bloomSizeMB = bloomBinary.length / 1024 / 1024;
      console.log(`  Output: ${bloomPath}`);
      console.log(`  Size: ${bloomSizeMB.toFixed(2)} MB`);
      console.log(`  Overflow addresses: ${stats.overflowCount.toLocaleString()}\n`);
    } else {
      console.log("  No overflow addresses, skipping Bloom.\n");
    }
  } else {
    // Core/standard mode: write Bloom + entity index
    console.log("[5/6] Writing filter binary...");
    const binary = filter.serialize();
    const outputPath = join(OUTPUT_DIR, opts.output);
    writeFileSync(outputPath, binary);
    const sizeMB = binary.length / 1024 / 1024;
    console.log(`  Output: ${outputPath}`);
    console.log(`  Size: ${sizeMB.toFixed(2)} MB\n`);

    // ── Phase 6: Write entity name index ──
    if (stats.entityIndex.length > 0) {
      console.log("[6/6] Writing entity name index...");
      const indexName = opts.output.replace("filter", "index");
      const indexPath = join(OUTPUT_DIR, indexName);
      const indexInfo = writeEntityIndex(indexPath, stats.entityNameTable, stats.entityIndex);
      const indexSizeMB = indexInfo.total / 1024 / 1024;
      console.log(`  Output: ${indexPath}`);
      console.log(`  Size: ${indexSizeMB.toFixed(2)} MB`);
      console.log(`  Entities: ${indexInfo.nameCount}`);
      console.log(`  Address mappings: ${indexInfo.entryCount.toLocaleString()}\n`);
    } else {
      console.log("[6/6] No entity mappings collected, skipping index.\n");
    }
  }

  // ── Summary ──
  console.log("=== Summary ===");
  console.log(`  Unique addresses: ~${stats.unique.toLocaleString()}`);
  console.log(`  Total processed:  ${stats.total.toLocaleString()}`);
  if (opts.full) {
    console.log(`  Index entries:    ${stats.entityIndex.length.toLocaleString()}`);
    console.log(`  Overflow entries: ${stats.overflowCount.toLocaleString()}`);
  }
  console.log(`  Dedup Bloom (m):  ${filter.m.toLocaleString()}`);
  console.log(`  FPR:              ${(opts.fpr * 100).toFixed(2)}%`);
  console.log();
  console.log("  By source:");
  for (const [src, count] of Object.entries(stats.sources).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`    ${src}: ${count.toLocaleString()}`);
  }
  console.log();
  console.log("  By category:");
  for (const [cat, count] of Object.entries(stats.categories).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`    ${cat}: ${count.toLocaleString()}`);
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
