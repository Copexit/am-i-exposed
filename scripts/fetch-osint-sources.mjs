#!/usr/bin/env node

/**
 * fetch-osint-sources.mjs
 *
 * Downloads Bitcoin address labels from Bithypha.com OSINT API.
 * 680K labeled notes across 5 sources (paginated POST API, 30/page).
 *
 * Output: CSV files in .cache/entity-data/curated/ compatible with
 *         build-entity-filter.mjs
 *
 * Usage:
 *   node scripts/fetch-osint-sources.mjs               # Full fetch (all sources)
 *   node scripts/fetch-osint-sources.mjs --source=Ransomwhere  # Single source
 *   node scripts/fetch-osint-sources.mjs --resume       # Resume interrupted fetch
 *   node scripts/fetch-osint-sources.mjs --parallel     # Fetch all sources in parallel
 *   node scripts/fetch-osint-sources.mjs --incremental  # Only fetch new pages since last run
 *   node scripts/fetch-osint-sources.mjs --dry-run      # Show plan without fetching
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CACHE_DIR = join(ROOT, ".cache", "entity-data");
const CURATED_DIR = join(CACHE_DIR, "curated");
const STATE_FILE = join(CACHE_DIR, ".bithypha-state.json");

// ───────────────── Config ─────────────────

const BITHYPHA_API = "https://bithypha.com/api/note/get";
const BITHYPHA_PAGE_SIZE = 1000; // request 1000; server may cap at 30 per response (unverified with large sources)
const PROGRESS_INTERVAL = 100; // log every N pages

const BITHYPHA_SOURCES = [
  { name: "BitcoinTalk", category: "unknown", estPages: 9314 },
  { name: "Reddit", category: "unknown", estPages: 8789 },
  { name: "Collectibles", category: "unknown", estPages: 4182 },
  { name: "Ransomwhere", category: "scam", estPages: 373 },
  { name: "Bithypha", category: "unknown", estPages: 1 },
  // OFAC skipped - already fetched via update-ofac.mjs
];

// ───────────────── CLI ─────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const getFlag = (name) => args.includes(name);
  const getValue = (name) => {
    const arg = args.find((a) => a.startsWith(`${name}=`));
    return arg ? arg.split("=")[1] : undefined;
  };
  return {
    source: getValue("--source"),
    resume: getFlag("--resume"),
    incremental: getFlag("--incremental"),
    parallel: getFlag("--parallel"),
    dryRun: getFlag("--dry-run"),
    help: getFlag("--help") || getFlag("-h"),
  };
}

// ───────────────── State management ─────────────────

function loadState() {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    } catch {
      console.warn("  Warning: corrupted state file, starting fresh");
    }
  }
  return { sources: {} };
}

function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ───────────────── Address validation ─────────────────

function isValidBitcoinAddress(addr) {
  if (!addr || typeof addr !== "string") return false;
  if (addr.length < 26 || addr.length > 90) return false;
  return /^(1|3|bc1|tb1)[a-zA-Z0-9]+$/.test(addr);
}

// ───────────────── Bithypha fetcher ─────────────────

/**
 * Fetch a single page from the Bithypha note API.
 * @returns {{ notes: Array, total: number }} or null on error
 */
async function fetchBithyphaPage(source, page, signal) {
  const body = JSON.stringify({
    page,
    limit: BITHYPHA_PAGE_SIZE,
    noteSources: [source],
  });

  const resp = await fetch(BITHYPHA_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal,
  });

  if (!resp.ok) {
    throw new Error(`Bithypha API error: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  if (!data.success) {
    throw new Error(`Bithypha API returned success=false for ${source} page ${page}`);
  }

  return { notes: data.notes || [], total: data.total || 0 };
}

/**
 * Fetch all pages for a single Bithypha source.
 * Returns a Set of unique addresses.
 */
async function fetchBithyphaSource(sourceCfg, state, signal) {
  const { name } = sourceCfg;
  const addresses = new Map(); // address -> first entity label seen
  const sourceState = state.sources[name] || { lastPage: 0, totalAddresses: 0 };

  // If already complete and not resuming from scratch, skip
  if (sourceState.complete) {
    console.log(`  [${name}] Already complete (${sourceState.totalAddresses} addresses), skipping`);
    return null; // signals "use existing CSV"
  }

  const startPage = sourceState.lastPage > 0 ? sourceState.lastPage + 1 : 1;
  let page = startPage;
  let totalPages = sourceCfg.estPages;
  let consecutiveErrors = 0;
  const MAX_ERRORS = 5;

  if (startPage > 1) {
    console.log(`  [${name}] Resuming from page ${startPage}`);
  }

  const startTime = Date.now();

  while (true) {
    if (signal?.aborted) {
      console.log(`\n  [${name}] Interrupted at page ${page}, saving state...`);
      break;
    }

    try {
      const { notes, total } = await fetchBithyphaPage(name, page, signal);

      // Update total pages from API response
      totalPages = Math.ceil(total / BITHYPHA_PAGE_SIZE);

      // Extract addresses from notes
      for (const note of notes) {
        const addrObj = note.bitcoinAddress;
        const addr = typeof addrObj === "object" ? addrObj?.address : addrObj;
        if (addr && isValidBitcoinAddress(addr)) {
          if (!addresses.has(addr)) {
            // Use note label if available, otherwise source name
            const label = note.label || note.noteSource || name;
            addresses.set(addr, label);
          }
        }
      }

      consecutiveErrors = 0;

      // Progress logging
      if (page % PROGRESS_INTERVAL === 0 || page === totalPages) {
        const elapsed = (Date.now() - startTime) / 1000;
        const pagesPerSec = (page - startPage + 1) / elapsed;
        const remaining = (totalPages - page) / pagesPerSec;
        const eta = remaining > 0 ? formatDuration(remaining) : "done";
        console.log(
          `  [${name}] Page ${page}/${totalPages} | ${addresses.size} unique addrs | ` +
            `${pagesPerSec.toFixed(1)} pg/s | ETA: ${eta}`
        );
      }

      // Update state periodically (every 50 pages)
      if (page % 50 === 0) {
        state.sources[name] = {
          lastPage: page,
          totalAddresses: addresses.size,
          lastRun: new Date().toISOString(),
        };
        saveState(state);
      }

      // Done?
      if (notes.length < BITHYPHA_PAGE_SIZE || page >= totalPages) {
        break;
      }

      page++;
    } catch (err) {
      if (signal?.aborted) break;

      consecutiveErrors++;
      if (consecutiveErrors >= MAX_ERRORS) {
        console.error(`  [${name}] ${MAX_ERRORS} consecutive errors, stopping. Last: ${err.message}`);
        break;
      }
      console.warn(`  [${name}] Page ${page} error (${consecutiveErrors}/${MAX_ERRORS}): ${err.message}`);
      // Brief pause before retry
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Final state update
  const complete = page >= totalPages;
  state.sources[name] = {
    lastPage: page,
    totalAddresses: addresses.size,
    totalNotes: totalPages * BITHYPHA_PAGE_SIZE, // approximate, updated by incremental
    lastRun: new Date().toISOString(),
    complete,
  };
  saveState(state);

  return addresses;
}

/**
 * Incremental fetch: only get new pages since last completed run.
 * Checks current total from API, fetches only pages beyond what we already have.
 * Returns new addresses to append, or null if no new data.
 */
async function incrementalFetchSource(sourceCfg, state, signal) {
  const { name } = sourceCfg;
  const sourceState = state.sources[name];

  if (!sourceState?.complete) {
    // Never completed a full fetch - skip in incremental mode (too slow for CI)
    console.log(`  [${name}] No complete state, skipping (run full fetch first)`);
    return null;
  }

  // Check current total by fetching page 1
  try {
    const { total } = await fetchBithyphaPage(name, 1, signal);
    const lastTotal = sourceState.totalNotes || 0;

    if (total <= lastTotal) {
      console.log(`  [${name}] No new notes (${total} total, had ${lastTotal})`);
      return null;
    }

    const newNotes = total - lastTotal;
    const lastPage = sourceState.lastPage || Math.ceil(lastTotal / BITHYPHA_PAGE_SIZE);
    const newTotalPages = Math.ceil(total / BITHYPHA_PAGE_SIZE);
    const newPageCount = newTotalPages - lastPage;

    console.log(`  [${name}] ${newNotes} new notes found (${lastTotal} -> ${total}), fetching ${newPageCount} new pages`);

    // Load existing addresses from CSV to avoid duplicates
    const existing = loadExistingCsv(`bithypha-${name.toLowerCase()}.csv`);
    const addresses = new Map(existing);
    const startSize = addresses.size;

    // Fetch only new pages
    const startPage = lastPage + 1;
    let page = startPage;
    const startTime = Date.now();

    while (page <= newTotalPages) {
      if (signal?.aborted) break;

      try {
        const { notes } = await fetchBithyphaPage(name, page, signal);

        for (const note of notes) {
          const addrObj = note.bitcoinAddress;
          const addr = typeof addrObj === "object" ? addrObj?.address : addrObj;
          if (addr && isValidBitcoinAddress(addr)) {
            if (!addresses.has(addr)) {
              const label = note.label || note.noteSource || name;
              addresses.set(addr, label);
            }
          }
        }

        if (page % PROGRESS_INTERVAL === 0 || page === newTotalPages) {
          const elapsed = (Date.now() - startTime) / 1000;
          const pagesPerSec = (page - startPage + 1) / elapsed;
          const remaining = (newTotalPages - page) / pagesPerSec;
          const eta = remaining > 0 ? formatDuration(remaining) : "done";
          console.log(
            `  [${name}] Page ${page}/${newTotalPages} | ${addresses.size - startSize} new addrs | ` +
              `${pagesPerSec.toFixed(1)} pg/s | ETA: ${eta}`
          );
        }

        if (notes.length < BITHYPHA_PAGE_SIZE || page >= newTotalPages) break;
        page++;
      } catch (err) {
        if (signal?.aborted) break;
        console.warn(`  [${name}] Page ${page} error: ${err.message}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Update state
    state.sources[name] = {
      ...sourceState,
      lastPage: page,
      totalAddresses: addresses.size,
      totalNotes: total,
      lastRun: new Date().toISOString(),
      complete: page >= newTotalPages,
    };
    saveState(state);

    const newCount = addresses.size - startSize;
    console.log(`  [${name}] +${newCount} new addresses (${addresses.size} total)`);

    return newCount > 0 ? addresses : null;
  } catch (err) {
    console.error(`  [${name}] Incremental check failed: ${err.message}`);
    return null;
  }
}

/**
 * Load existing addresses from a curated CSV file.
 * Returns Map<address, label> or empty Map if file doesn't exist.
 */
function loadExistingCsv(filename) {
  const csvPath = join(CURATED_DIR, filename);
  const addresses = new Map();
  if (!existsSync(csvPath)) return addresses;

  const content = readFileSync(csvPath, "utf-8");
  const lines = content.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Handle quoted fields
    const firstComma = line.indexOf(",");
    if (firstComma === -1) continue;
    const addr = line.slice(0, firstComma);
    const rest = line.slice(firstComma + 1);
    const secondComma = rest.indexOf(",");
    const label = secondComma === -1 ? rest : rest.slice(0, secondComma);
    if (addr && addr !== "address") {
      addresses.set(addr, label.replace(/^"|"$/g, ""));
    }
  }
  return addresses;
}

/**
 * Write a Map<address, label> to a curated CSV file.
 */
function writeAddressCsv(filename, addresses, category, sourceTag) {
  const csvPath = join(CURATED_DIR, filename);
  const lines = ["address,entity,source"];
  for (const [addr, label] of addresses) {
    // Escape commas in labels
    const safeLabel = label.includes(",") ? `"${label}"` : label;
    lines.push(`${addr},${safeLabel},${sourceTag}`);
  }
  mkdirSync(CURATED_DIR, { recursive: true });
  writeFileSync(csvPath, lines.join("\n") + "\n");
  console.log(`  Wrote ${addresses.size} addresses to ${filename}`);
}

// ───────────────── Utils ─────────────────

function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h${m}m`;
}

function printUsage() {
  console.log(`
Usage: node scripts/fetch-osint-sources.mjs [options]

Options:
  --source=NAME     Fetch only one source (BitcoinTalk, Reddit, Collectibles, Ransomwhere, Bithypha)
  --resume          Resume interrupted fetch from saved state
  --incremental     Only fetch new pages since last completed run (fast, for CI)
  --parallel        Fetch all sources in parallel (~5.7h vs ~14h sequential)
  --dry-run         Show plan without fetching
  --help            Show this help

Output: .cache/entity-data/curated/bithypha-*.csv
`);
}

// ───────────────── Main ─────────────────

async function main() {
  const opts = parseArgs();

  if (opts.help) {
    printUsage();
    process.exit(0);
  }

  console.log("OSINT Source Fetcher");
  console.log("====================\n");

  mkdirSync(CURATED_DIR, { recursive: true });

  // --- Determine which bithypha sources to fetch ---
  let bithyphaSources = BITHYPHA_SOURCES;
  if (opts.source) {
    const match = BITHYPHA_SOURCES.find(
      (s) => s.name.toLowerCase() === opts.source.toLowerCase()
    );
    if (!match) {
      console.error(`Unknown source: ${opts.source}`);
      console.error(`Available: ${BITHYPHA_SOURCES.map((s) => s.name).join(", ")}`);
      process.exit(1);
    }
    bithyphaSources = [match];
  }

  // --- Dry run ---
  if (opts.dryRun) {
    console.log("Bithypha sources:");
    for (const s of bithyphaSources) {
      const pages = s.estPages;
      const estTime = formatDuration(pages * 2.2);
      console.log(`  ${s.name}: ~${pages} pages, ~${estTime}`);
    }
    if (opts.parallel) {
      const maxPages = Math.max(...bithyphaSources.map((s) => s.estPages));
      console.log(`\nParallel total: ~${formatDuration(maxPages * 2.2)}`);
    } else {
      const totalPages = bithyphaSources.reduce((s, x) => s + x.estPages, 0);
      console.log(`\nSequential total: ~${formatDuration(totalPages * 2.2)}`);
    }
    process.exit(0);
  }

  // --- Set up graceful shutdown ---
  const abortController = new AbortController();
  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nGraceful shutdown requested, finishing current page...");
    abortController.abort();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // --- Fetch bithypha sources ---
  const state = (opts.resume || opts.incremental) ? loadState() : { sources: {} };

  // If resuming/incremental, show current state
  if (opts.resume || opts.incremental) {
    const completed = Object.entries(state.sources)
      .filter(([, s]) => s.complete)
      .map(([name]) => name);
    if (completed.length > 0) {
      console.log(`${opts.incremental ? "Incremental" : "Resuming"}. Already complete: ${completed.join(", ")}`);
    }
  }

  // Choose fetch function based on mode
  const fetchFn = opts.incremental ? incrementalFetchSource : fetchBithyphaSource;
  const modeLabel = opts.incremental ? "incremental" : "full";

  if (opts.parallel) {
    console.log(`Fetching ${bithyphaSources.length} sources in parallel (${modeLabel})...\n`);

    const results = await Promise.allSettled(
      bithyphaSources.map(async (sourceCfg) => {
        const addresses = await fetchFn(
          sourceCfg,
          state,
          abortController.signal
        );
        if (addresses && addresses.size > 0) {
          const filename = `bithypha-${sourceCfg.name.toLowerCase()}.csv`;
          writeAddressCsv(filename, addresses, sourceCfg.category, `bithypha-${sourceCfg.name.toLowerCase()}`);
        }
        return { source: sourceCfg.name, count: addresses?.size || 0 };
      })
    );

    console.log("\nResults:");
    for (const r of results) {
      if (r.status === "fulfilled") {
        console.log(`  ${r.value.source}: ${r.value.count} addresses`);
      } else {
        console.error(`  Error: ${r.reason?.message || r.reason}`);
      }
    }
  } else {
    console.log(`Fetching ${bithyphaSources.length} source(s) sequentially (${modeLabel})...\n`);

    for (const sourceCfg of bithyphaSources) {
      if (abortController.signal.aborted) break;

      console.log(`\nSource: ${sourceCfg.name}`);

      const addresses = await fetchFn(
        sourceCfg,
        state,
        abortController.signal
      );

      if (addresses && addresses.size > 0) {
        const filename = `bithypha-${sourceCfg.name.toLowerCase()}.csv`;
        writeAddressCsv(filename, addresses, sourceCfg.category, `bithypha-${sourceCfg.name.toLowerCase()}`);
      }
    }
  }

  saveState(state);

  console.log("\nDone. Run 'node scripts/build-entity-filter.mjs --core' to rebuild indexes.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
