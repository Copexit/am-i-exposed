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

// Everyday transactions from block 850000 (one per input/output shape and
// script type). Stored with raw hex so hex-based heuristics are exercised.
// Consumed by src/lib/analysis/__tests__/golden-corpus.test.ts.
const CORPUS_TXIDS = [
  "242b2de161deac31f77238b898e85a5e4760c5aa004ede2e2cc355202f84e6aa", // 1-1 p2wpkh
  "1a0198d5942a511109a3a726a20e381bdbfbeecc6c98fde20ce8a571dfb5757c", // 1-2 p2wpkh
  "d98f14d555b9db58e2fb5597fe17223b3042cd2ab431233cf5b4828e94fbac7e", // 1-3 p2wpkh
  "635b025b146d760d613244f6b1f7a28519104628d2ff8a76076e4fb204db3600", // 1-13 p2wpkh
  "60848192841f6daccc451db71e18d816c217c09f04a8ffa05e216705c06280fe", // 2-2 p2wpkh
  "21797d49e0de12428b30feed413e04b8142bd65f0a93be29caa4321b8c1be13f", // 2-4 p2wpkh
  "68b76a9f359782d75f6acbbf88b172859eb5f38167a8d87c2f5836124dd2e731", // 3-3 p2wpkh
  "9e65c23dc39d5c3e112404bef8425c6563366d9a484e8845054398b6388e3a3c", // 4-2 p2wpkh
  "2d2dcc80195541dd44209dcfeb25393c8c8710f262360368a618b7ff3fa3f08c", // 5-1 p2wpkh
  "2494d26de43697c5dd84917225c2daddd44b23c2ac6be2e2ca8c0a56746dd0ae", // 2-2 p2tr
  "bb8e57e42ab0e028e56a170f65f9013d5c77b324b067838b0199ddec1b547511", // 1-3 p2tr
  "53d885d1aa07f481ae4d5e1976fc3b8a230c8dafe0f94167dfc02ebc2b9b071a", // 9-9 p2tr
  "d3a0efbe90835b524ca34484cc80d67eab608d41d2aa96da0830e8d157943f1d", // 1-2 p2pkh
  "a3d271e5377c35a27711b8e967964cc110b799b6c3a42f9ce5f4e66a26f2ebd5", // 2-2 p2pkh
  "8ce796fe58a9292770178b199f1368adfeb6671a63dae3243b06b9e52769ec47", // 3-1 p2sh
  "58a7b1b7ef1e0c3bdce1c5df5ca4ff5120e49ae64f16e8945993fbad71818240", // 1-2 p2wsh
  "b10c0000004da5a9d1d9b4ae32e09f0b3e62d21a5cce5428d4ad714fb444eb5d", // 10-9 every script type
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

mkdirSync(`${DIR}/corpus`, { recursive: true });
for (const txid of CORPUS_TXIDS) {
  const tx = await fetchJson(`${API}/tx/${txid}`);
  const hexRes = await fetch(`${API}/tx/${txid}/hex`);
  if (!tx || !hexRes.ok) {
    console.error(`Failed to fetch corpus tx ${txid}`);
    continue;
  }
  const hex = await hexRes.text();
  writeFileSync(`${DIR}/corpus/${txid}.json`, JSON.stringify({ tx, hex }, null, 2));
  console.log(`Saved corpus ${txid.slice(0, 12)}`);
  await new Promise((r) => setTimeout(r, 500));
}

console.log("\nAll fixtures saved to:", DIR);
