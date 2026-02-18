/**
 * Quick engine test script - fetches real tx data and runs analysis.
 * Run with: node --experimental-strip-types scripts/test-engine.mjs
 */

const MEMPOOL_API = "https://mempool.space/api";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

// Inline scoring logic
function calculateScore(findings) {
  const BASE = 70;
  const total = findings.reduce((s, f) => s + f.scoreImpact, 0);
  const score = Math.max(0, Math.min(100, BASE + total));
  const grade = score >= 90 ? "A+" : score >= 75 ? "B" : score >= 50 ? "C" : score >= 25 ? "D" : "F";
  return { score, grade, findingCount: findings.length };
}

// Test cases
const TX_TESTS = [
  { name: "Whirlpool CoinJoin", txid: "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2", expect: "A+" },
  { name: "OP_RETURN (charley loves heidi)", txid: "8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684", expect: "C-D" },
  { name: "Taproot + OP_RETURN (BitGo)", txid: "0bf67b1f05326afbd613e11631a2b86466ac7e255499f6286e31b9d7d889cee7", expect: "C" },
  { name: "Simple Legacy P2PKH", txid: "0b6461de422c46a221db99608fcbe0326e4f2325ebf2a47c9faf660ed61ee6a4", expect: "C" },
];

const ADDR_TESTS = [
  { name: "Satoshi Genesis (extreme reuse)", addr: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", expect: "F" },
];

console.log("=== Transaction Tests ===\n");

for (const test of TX_TESTS) {
  try {
    const tx = await fetchJson(`${MEMPOOL_API}/tx/${test.txid}`);
    const findings = [];

    // H1: Round amounts
    const outputs = tx.vout;
    if (outputs.length >= 2) {
      let roundCount = 0;
      for (const out of outputs) {
        const v = out.value;
        if (v % 1000000 === 0 || v % 100000 === 0 || v % 10000 === 0) roundCount++;
      }
      if (roundCount > 0 && roundCount < outputs.length) {
        findings.push({ id: "h1", severity: "low", title: "Round amounts", scoreImpact: -Math.min(roundCount * 5, 15) });
      }
    }

    // H3: CIOH
    const uniqueAddrs = new Set();
    for (const vin of tx.vin) {
      if (vin.prevout?.scriptpubkey_address) uniqueAddrs.add(vin.prevout.scriptpubkey_address);
    }
    if (uniqueAddrs.size > 1) {
      findings.push({ id: "h3", severity: "medium", title: `CIOH: ${uniqueAddrs.size} addresses`, scoreImpact: -Math.min(uniqueAddrs.size * 3, 15) });
    }

    // H4: CoinJoin
    const valueCounts = new Map();
    for (const out of tx.vout) {
      valueCounts.set(out.value, (valueCounts.get(out.value) || 0) + 1);
    }
    let maxEqCount = 0;
    for (const [, count] of valueCounts) {
      if (count > maxEqCount) { maxEqCount = count; }
    }

    // Whirlpool check
    const WHIRLPOOL_DENOMS = [100000, 1000000, 5000000, 50000000];
    let isWhirlpool = false;
    for (const denom of WHIRLPOOL_DENOMS) {
      if (tx.vout.filter(o => o.value === denom).length === 5) {
        findings.push({ id: "h4-whirlpool", severity: "good", title: `Whirlpool CoinJoin (${denom/1e8} BTC)`, scoreImpact: 30 });
        isWhirlpool = true;
        break;
      }
    }
    if (!isWhirlpool && maxEqCount >= 3) {
      const impact = maxEqCount >= 10 ? 25 : maxEqCount >= 5 ? 20 : 15;
      findings.push({ id: "h4", severity: "good", title: `CoinJoin: ${maxEqCount} equal outputs`, scoreImpact: impact });
    }

    // H7: OP_RETURN
    const opReturns = tx.vout.filter(o => o.scriptpubkey_type === "op_return");
    if (opReturns.length > 0) {
      findings.push({ id: "h7", severity: "medium", title: `OP_RETURN data`, scoreImpact: -5 });
    }

    // H5: Simple entropy
    if (tx.vin.length === 1 && tx.vout.length === 1) {
      findings.push({ id: "h5", severity: "low", title: "Zero entropy", scoreImpact: -5 });
    } else if (maxEqCount >= 5) {
      findings.push({ id: "h5", severity: "good", title: "High entropy", scoreImpact: 15 });
    }

    const result = calculateScore(findings);
    const pass = test.expect.includes(result.grade) || test.expect === result.grade;
    console.log(`${pass ? "PASS" : "FAIL"} ${test.name}`);
    console.log(`  Score: ${result.score}/100 (${result.grade}) [expected: ${test.expect}]`);
    console.log(`  Findings: ${findings.map(f => `${f.id}(${f.scoreImpact})`).join(", ")}`);
    console.log();
  } catch (err) {
    console.log(`ERROR ${test.name}: ${err.message}\n`);
  }
}

console.log("=== Address Tests ===\n");

for (const test of ADDR_TESTS) {
  try {
    const addr = await fetchJson(`${MEMPOOL_API}/address/${test.addr}`);
    const findings = [];

    // H8: Address reuse
    const totalFunded = addr.chain_stats.funded_txo_count + addr.mempool_stats.funded_txo_count;
    if (totalFunded > 1) {
      const impact = totalFunded >= 10 ? -35 : totalFunded >= 5 ? -28 : -20;
      findings.push({ id: "h8", severity: "critical", title: `Reused ${totalFunded}x`, scoreImpact: impact });
    }

    // H10: Address type
    if (test.addr.startsWith("1")) {
      findings.push({ id: "h10", severity: "medium", title: "Legacy P2PKH", scoreImpact: -5 });
    }

    const result = calculateScore(findings);
    const pass = test.expect.includes(result.grade) || test.expect === result.grade;
    console.log(`${pass ? "PASS" : "FAIL"} ${test.name}`);
    console.log(`  Score: ${result.score}/100 (${result.grade}) [expected: ${test.expect}]`);
    console.log(`  Funded: ${totalFunded}x`);
    console.log(`  Findings: ${findings.map(f => `${f.id}(${f.scoreImpact})`).join(", ")}`);
    console.log();
  } catch (err) {
    console.log(`ERROR ${test.name}: ${err.message}\n`);
  }
}
