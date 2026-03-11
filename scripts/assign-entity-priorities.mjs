#!/usr/bin/env node

/**
 * assign-entity-priorities.mjs
 *
 * One-time script to assign priority scores (1-10) to all entities in entities.json.
 * Priority determines how much named index budget each entity receives in the
 * build pipeline. Higher priority = more addresses in the named index (vs overflow Bloom).
 *
 * Usage:
 *   node scripts/assign-entity-priorities.mjs          # Dry run (shows assignments)
 *   node scripts/assign-entity-priorities.mjs --write   # Write to entities.json
 */

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTITIES_PATH = join(__dirname, "..", "src", "data", "entities.json");

// ── Category base priorities ──
const CATEGORY_BASE = {
  darknet: 8,
  mixer: 7,
  scam: 6,
  exchange: 4,
  mining: 4,
  gambling: 3,
  payment: 3,
  p2p: 3,
};

// ── Notorious entity overrides (manually curated) ──
// These override the category base for well-known entities.
const NOTORIOUS = {
  // Priority 10: OFAC + notorious darknet/mixer
  "Silk Road": 10,
  "Hydra": 10,
  "Chipmixer": 10,
  "Tornado Cash": 10,
  "Lazarus Group": 10,

  // Priority 9: OFAC exchanges, major seized entities, top darknet
  "AlphaBay": 9,
  "Agora": 9,
  "Evolution": 9,
  "Bitcoin Fog": 9,
  "BTC-e": 9,
  "Garantex": 9,
  "Suex": 9,
  "Bitzlato": 9,
  "Conti Ransomware": 9,
  "DarkSide Ransomware": 9,
  "REvil Ransomware": 9,
  "Sinbad": 9,
  "Blender.io": 9,

  // Priority 8: Major darknet markets, major scams, key historical
  "Hansa": 8,
  "Dream Market": 8,
  "Wall Street Market": 8,
  "Silk Road 2.0": 8,
  "PlusToken": 8,
  "OneCoin": 8,
  "Mt. Gox": 8,
  "BitConnect": 8,
  "LockBit": 8,
  "Chatex": 8,
  "BLNK Financial": 8,

  // Priority 7: Top exchanges (active + notable closed)
  "Binance": 7,
  "Coinbase": 7,
  "Kraken": 7,
  "FTX": 7,
  "Bitfinex": 7,
  "Binance US": 7,

  // Priority 6: Active mixers, top-25 exchanges, notable scams
  "Wasabi Wallet (coordinator)": 6,
  "Whirlpool (coordinator)": 6,
  "JoinMarket": 6,
  "OKX": 6,
  "Bybit": 6,
  "Crypto.com": 6,
  "Huobi (HTX)": 6,
  "Celsius": 6,
  "BlockFi": 6,
  "Voyager": 6,
  "QuadrigaCX": 6,
  "WoToken": 6,
  "Finiko": 6,
  "Thodex": 6,
  "HyperFund": 6,

  // Priority 5: Mid-tier exchanges, major P2P, notable gambling
  "Gemini": 5,
  "Bitstamp": 5,
  "BitMEX": 5,
  "KuCoin": 5,
  "Gate.io": 5,
  "Upbit": 5,
  "Bithumb": 5,
  "Bisq": 5,
  "Stake.com": 5,
  "LocalBitcoins": 5,
  "Paxful": 5,
  "ShapeShift": 5,
  "Blockchain.com": 5,
  "Cryptopia": 5,
  "NiceHash": 5,
  "Poloniex": 4,

  // Explicit deprioritization: high-volume, low-relevance entities
  "ePay.info": 1,
  "Cubits": 1,
  "CoinTrader": 1,
  "999Dice": 1,
  "CoinGaming": 2,
  "Xapo Bank": 2,
  "Bittrex": 3,
};

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function assignPriority(entity) {
  // Check notorious overrides first
  if (NOTORIOUS[entity.name] !== undefined) {
    return NOTORIOUS[entity.name];
  }

  // Start with category base
  let base = CATEGORY_BASE[entity.category] ?? 3;

  // OFAC bump
  if (entity.ofac) {
    base = Math.max(base, 9);
  }

  // Closed entities get -1 if not already high priority
  if (entity.status === "closed" && base < 7) {
    base -= 1;
  }

  return clamp(base, 1, 10);
}

function main() {
  const writeMode = process.argv.includes("--write");
  const data = JSON.parse(readFileSync(ENTITIES_PATH, "utf-8"));

  const priorityDist = {};
  const assignments = [];

  for (const entity of data.entities) {
    const priority = assignPriority(entity);
    entity.priority = priority;
    priorityDist[priority] = (priorityDist[priority] || 0) + 1;
    assignments.push({ name: entity.name, category: entity.category, priority, ofac: entity.ofac, status: entity.status });
  }

  // Print assignments grouped by priority (descending)
  console.log("=== Entity Priority Assignments ===\n");
  for (let p = 10; p >= 1; p--) {
    const group = assignments.filter(a => a.priority === p);
    if (group.length === 0) continue;
    console.log(`Priority ${p} (${group.length} entities):`);
    for (const a of group) {
      const flags = [];
      if (a.ofac) flags.push("OFAC");
      if (a.status === "closed") flags.push("closed");
      const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
      console.log(`  ${a.name} (${a.category})${flagStr}`);
    }
    console.log();
  }

  console.log("=== Distribution ===");
  for (let p = 10; p >= 1; p--) {
    if (priorityDist[p]) {
      console.log(`  Priority ${p}: ${priorityDist[p]} entities`);
    }
  }
  console.log(`  Total: ${data.entities.length}\n`);

  if (writeMode) {
    writeFileSync(ENTITIES_PATH, JSON.stringify(data, null, 2) + "\n");
    console.log(`Written priorities to ${ENTITIES_PATH}`);
  } else {
    console.log("Dry run. Use --write to save to entities.json.");
  }
}

main();
