/**
 * Live smoke-test for src/lib/api/detect-network.ts against the real
 * mempool.space API. Not part of CI - run manually with:
 *
 *   node scripts/live-probe-detect-network.mjs
 *
 * Picks a fresh txid from each public network's tip block, then asks
 * detectTxidNetwork() (logic inlined here as plain JS, mirrors the TS
 * source verbatim) to identify it given a wrong fromNetwork. Prints
 * pass/fail per scenario.
 */

const NETWORK_CONFIG = {
  mainnet:  { mempoolBaseUrl: "https://mempool.space/api" },
  testnet4: { mempoolBaseUrl: "https://mempool.space/testnet4/api" },
  signet:   { mempoolBaseUrl: "https://mempool.space/signet/api" },
  testnet3: { mempoolBaseUrl: "https://mempool.space/testnet/api" },
};

const PROBE_NETWORKS = ["mainnet", "testnet4", "signet", "testnet3"];

// Mirror of src/lib/api/detect-network.ts detectTxidNetwork().
async function detectTxidNetwork(txid, fromNetwork, signal) {
  if (!/^[a-fA-F0-9]{64}$/.test(txid)) return null;
  const others = PROBE_NETWORKS.filter((n) => n !== fromNetwork);
  const probes = others.map(async (net) => {
    const url = `${NETWORK_CONFIG[net].mempoolBaseUrl}/tx/${txid}/hex`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`${net}: ${res.status}`);
    return net;
  });
  try {
    return await Promise.any(probes);
  } catch {
    return null;
  }
}

async function pickRecentTxid(baseUrl) {
  const tip = await fetch(`${baseUrl}/blocks/tip/hash`).then((r) => r.text());
  const txids = await fetch(`${baseUrl}/block/${tip}/txids`).then((r) => r.json());
  return txids[1] ?? txids[0];
}

async function main() {
  let pass = 0;
  let fail = 0;
  const scenarios = [];

  for (const [actualNet, { mempoolBaseUrl }] of Object.entries(NETWORK_CONFIG)) {
    try {
      const txid = await pickRecentTxid(mempoolBaseUrl);
      scenarios.push({ actualNet, txid });
      console.log(`picked ${actualNet.padEnd(8)} txid ${txid.slice(0, 16)}...`);
    } catch (e) {
      console.error(`failed to pick txid for ${actualNet}: ${e.message}`);
    }
  }
  console.log("");

  for (const { actualNet, txid } of scenarios) {
    for (const fromNet of Object.keys(NETWORK_CONFIG)) {
      if (fromNet === actualNet) continue;
      const detected = await detectTxidNetwork(txid, fromNet);
      const ok = detected === actualNet;
      console.log(`  ${ok ? "PASS" : "FAIL"}  from=${fromNet.padEnd(8)} actual=${actualNet.padEnd(8)} detected=${String(detected).padEnd(8)}  ${txid.slice(0, 12)}...`);
      if (ok) pass++;
      else fail++;
    }
  }

  const synthetic = "0".repeat(64);
  const detected = await detectTxidNetwork(synthetic, "mainnet");
  const negOk = detected === null;
  console.log(`  ${negOk ? "PASS" : "FAIL"}  negative all-zero txid -> ${detected}`);
  if (negOk) pass++;
  else fail++;

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
