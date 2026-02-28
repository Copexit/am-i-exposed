#!/usr/bin/env node
// Fetches real mempool.space API responses for reference transactions
// and saves them as JSON fixtures for deterministic offline testing.
// Usage: node scripts/capture-fixtures.mjs

import { writeFileSync, mkdirSync } from "fs";

const API = "https://mempool.space/api";
const DIR = "src/lib/analysis/heuristics/__tests__/fixtures/api-responses";

const TX_CASES = [
  { name: "whirlpool-coinjoin", txid: "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2" },
  { name: "wabisabi-coinjoin", txid: "fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e" },
  { name: "joinmarket-coinjoin", txid: "4f112abd2eefe3484a7bbf7c1731f784cba19de677468835145e9c448fb18b7d" },
  { name: "taproot-op-return", txid: "0bf67b1f05326afbd613e11631a2b86466ac7e255499f6286e31b9d7d889cee7" },
  { name: "bare-multisig", txid: "60a20bd93aa49ab4b28d514ec10b06e1829ce6818ec06cd3aabd013ebcdc4bb1" },
  { name: "op-return-charley", txid: "8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684" },
  { name: "simple-legacy-p2pkh", txid: "0b6461de422c46a221db99608fcbe0326e4f2325ebf2a47c9faf660ed61ee6a4" },
  { name: "batch-withdrawal-143", txid: "3d81a6b95903dd457d45a2fc998acc42fe96f59ef01157bdcbc331fe451c8d9e" },
  { name: "dust-attack-555", txid: "655c533bf059721cec9d3d70b3171a07997991a02fedfa1c9b593abc645e1cc5" },
  { name: "taproot-script-path", txid: "37777defed8717c581b4c0509329550e344bdc14ac38f71fc050096887e535c8" },
];

const ADDR_CASES = [
  { name: "satoshi-genesis", address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" },
];

mkdirSync(DIR, { recursive: true });

for (const { name, txid } of TX_CASES) {
  const res = await fetch(`${API}/tx/${txid}`);
  if (!res.ok) {
    console.error(`Failed to fetch ${name}: HTTP ${res.status}`);
    continue;
  }
  const json = await res.json();
  writeFileSync(`${DIR}/${name}.json`, JSON.stringify(json, null, 2));
  console.log(`Saved ${name}`);
  await new Promise((r) => setTimeout(r, 500)); // rate limit courtesy
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    console.warn(`  Warning: ${url} returned ${res.status}: ${text.slice(0, 100)}`);
    return null;
  }
  return res.json();
}

for (const { name, address } of ADDR_CASES) {
  const addr = await fetchJson(`${API}/address/${address}`);
  const utxos = await fetchJson(`${API}/address/${address}/utxo`);
  const txs = await fetchJson(`${API}/address/${address}/txs`);

  if (addr) writeFileSync(`${DIR}/${name}-address.json`, JSON.stringify(addr, null, 2));
  writeFileSync(`${DIR}/${name}-utxos.json`, JSON.stringify(utxos ?? [], null, 2));
  if (txs) writeFileSync(`${DIR}/${name}-txs.json`, JSON.stringify(txs, null, 2));
  console.log(`Saved ${name} (address + utxos + txs)`);
}

console.log("\nAll fixtures saved to:", DIR);
