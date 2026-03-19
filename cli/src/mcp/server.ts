/**
 * MCP (Model Context Protocol) server for am-i-exposed.
 *
 * Exposes the Bitcoin privacy analysis engine as structured tools
 * over stdio. Agents connect via MCP instead of shelling out to the CLI.
 *
 * CRITICAL: Never use console.log() here - it corrupts the JSON-RPC stream.
 * Use console.error() for debug output.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createMempoolClient } from "@/lib/api/mempool";
import { analyzeTransaction } from "@/lib/analysis/orchestrator";
import { analyzeAddress } from "@/lib/analysis/orchestrator";
import {
  selectRecommendations,
} from "@/lib/recommendations/primary-recommendation";
import type { TxContext } from "@/lib/analysis/heuristics/types";
import type { MempoolTransaction } from "@/lib/api/types";
import { getAddressType } from "@/lib/bitcoin/address-type";
import { parsePSBT, isPSBT } from "@/lib/bitcoin/psbt";
import { parseXpub, deriveOneAddress } from "@/lib/bitcoin/descriptor";
import { auditWallet, type WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import { computeBoltzmann } from "../adapters/boltzmann-node";
import { analyzeCoinJoin } from "@/lib/analysis/heuristics/coinjoin";
import { initEntityFilter } from "../adapters/entity-loader";

function resolveApiUrl(network: string, apiUrl?: string): string {
  if (apiUrl) return apiUrl;
  if (network === "testnet4") return "https://mempool.space/testnet4/api";
  if (network === "signet") return "https://mempool.space/signet/api";
  return "https://mempool.space/api";
}

export async function startMcpServer(): Promise<void> {
  // Load entity filter once at startup
  await initEntityFilter();

  const server = new McpServer({
    name: "am-i-exposed",
    version: "0.34.3",
  });

  // ---- scan_transaction ----

  server.tool(
    "scan_transaction",
    "Analyze a Bitcoin transaction for privacy exposure. Runs 25 heuristics including CoinJoin detection, change detection, wallet fingerprinting, entity detection, and entropy analysis.",
    {
      txid: z.string().regex(/^[0-9a-fA-F]{64}$/).describe("64-character hex transaction ID"),
      network: z.enum(["mainnet", "testnet4", "signet"]).default("mainnet").describe("Bitcoin network"),
      apiUrl: z.string().optional().describe("Custom mempool API URL"),
      fast: z.boolean().default(false).describe("Skip parent tx fetching for faster analysis"),
    },
    async ({ txid, network, apiUrl, fast }) => {
      const client = createMempoolClient(resolveApiUrl(network, apiUrl));
      const tx = await client.getTransaction(txid);
      let rawHex: string | undefined;
      try { rawHex = await client.getTxHex(txid); } catch { /* optional */ }

      let ctx: TxContext = {};
      if (!fast) {
        ctx = await buildTxContext(tx, client);
      }

      const result = await analyzeTransaction(tx, rawHex, undefined, ctx);
      const [rec] = selectRecommendations({
        findings: result.findings, grade: result.grade,
        txType: result.txType, walletGuess: null,
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            score: result.score, grade: result.grade, txType: result.txType,
            findings: result.findings,
            recommendation: rec ? { id: rec.id, urgency: rec.urgency, headline: rec.headlineDefault } : null,
          }, null, 2),
        }],
      };
    },
  );

  // ---- scan_address ----

  server.tool(
    "scan_address",
    "Analyze a Bitcoin address for privacy exposure. Checks address reuse, UTXO hygiene, spending patterns, entity identification, and temporal correlation.",
    {
      address: z.string().describe("Bitcoin address (any format)"),
      network: z.enum(["mainnet", "testnet4", "signet"]).default("mainnet"),
      apiUrl: z.string().optional(),
    },
    async ({ address, network, apiUrl }) => {
      if (getAddressType(address) === "unknown") {
        throw new Error(`Invalid Bitcoin address: "${address}"`);
      }
      const client = createMempoolClient(resolveApiUrl(network, apiUrl));
      const [addressData, utxos, txs] = await Promise.all([
        client.getAddress(address),
        client.getAddressUtxos(address),
        client.getAddressTxs(address),
      ]);
      const result = await analyzeAddress(addressData, utxos, txs);
      const [rec] = selectRecommendations({
        findings: result.findings, grade: result.grade, walletGuess: null,
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            score: result.score, grade: result.grade,
            addressType: getAddressType(address),
            findings: result.findings,
            recommendation: rec ? { id: rec.id, urgency: rec.urgency, headline: rec.headlineDefault } : null,
          }, null, 2),
        }],
      };
    },
  );

  // ---- scan_psbt ----

  server.tool(
    "scan_psbt",
    "Analyze an unsigned Bitcoin transaction (PSBT) BEFORE broadcasting. Requires zero network access. The key tool for checking transaction privacy before sending.",
    {
      psbt: z.string().describe("PSBT data as base64 or hex string"),
    },
    async ({ psbt }) => {
      if (!isPSBT(psbt)) {
        throw new Error("Invalid PSBT format");
      }
      const parsed = parsePSBT(psbt);
      const result = await analyzeTransaction(parsed.tx);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            score: result.score, grade: result.grade, txType: result.txType,
            inputs: parsed.tx.vin.length,
            outputs: parsed.tx.vout.length,
            estimatedFee: parsed.tx.fee ?? null,
            findings: result.findings,
          }, null, 2),
        }],
      };
    },
  );

  // ---- scan_wallet ----

  server.tool(
    "scan_wallet",
    "Audit wallet privacy via extended public key or output descriptor. Derives addresses, scans activity, and checks address reuse, UTXO hygiene, and consolidation patterns.",
    {
      descriptor: z.string().describe("xpub, zpub, ypub, or output descriptor"),
      network: z.enum(["mainnet", "testnet4", "signet"]).default("mainnet"),
      apiUrl: z.string().optional(),
      gapLimit: z.number().default(20).describe("Consecutive unused addresses before stopping"),
    },
    async ({ descriptor, network, apiUrl, gapLimit }) => {
      const client = createMempoolClient(resolveApiUrl(network, apiUrl));
      const parsed = parseXpub(descriptor);
      const allAddresses: WalletAddressInfo[] = [];

      for (const chain of [0, 1]) {
        let consecutiveEmpty = 0;
        for (let index = 0; consecutiveEmpty < gapLimit; index++) {
          const derived = deriveOneAddress(parsed, chain, index);
          let addressData = null;
          let txs: Awaited<ReturnType<typeof client.getAddressTxs>> = [];
          let utxos: Awaited<ReturnType<typeof client.getAddressUtxos>> = [];
          try {
            [addressData, txs, utxos] = await Promise.all([
              client.getAddress(derived.address),
              client.getAddressTxs(derived.address),
              client.getAddressUtxos(derived.address),
            ]);
          } catch { /* skip */ }
          const txCount = addressData
            ? addressData.chain_stats.tx_count + addressData.mempool_stats.tx_count
            : 0;
          consecutiveEmpty = txCount === 0 ? consecutiveEmpty + 1 : 0;
          allAddresses.push({ derived, addressData, txs, utxos });
          if (index % 3 === 2) await new Promise((r) => setTimeout(r, 500));
        }
      }

      const result = auditWallet(allAddresses);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            score: result.score, grade: result.grade,
            activeAddresses: result.activeAddresses,
            totalTxs: result.totalTxs,
            totalUtxos: result.totalUtxos,
            totalBalance: result.totalBalance,
            reusedAddresses: result.reusedAddresses,
            dustUtxos: result.dustUtxos,
            findings: result.findings,
          }, null, 2),
        }],
      };
    },
  );

  // ---- compute_boltzmann ----

  server.tool(
    "compute_boltzmann",
    "Compute Boltzmann entropy, wallet efficiency, and link probability matrix for a transaction. Requires 2+ inputs. Auto-detects WabiSabi/JoinMarket for turbo mode.",
    {
      txid: z.string().regex(/^[0-9a-fA-F]{64}$/),
      network: z.enum(["mainnet", "testnet4", "signet"]).default("mainnet"),
      apiUrl: z.string().optional(),
      timeoutSeconds: z.number().default(300),
    },
    async ({ txid, network, apiUrl, timeoutSeconds }) => {
      const client = createMempoolClient(resolveApiUrl(network, apiUrl));
      const tx = await client.getTransaction(txid);
      const inputValues = tx.vin.map((v) => v.prevout?.value ?? 0);
      const outputValues = tx.vout.filter((v) => v.value > 0).map((v) => v.value);

      if (inputValues.length < 2) {
        throw new Error(`Boltzmann requires 2+ inputs (this tx has ${inputValues.length})`);
      }

      // Auto-detect turbo mode via coinjoin heuristic
      const { findings: cjFindings } = analyzeCoinJoin(tx);
      const isWabiSabi = cjFindings.some((f) => f.params?.isWabiSabi === 1);
      const jmFinding = cjFindings.find((f) => f.id === "h4-joinmarket");

      const { computeBoltzmannWabiSabi, computeBoltzmannJoinMarket } =
        await import("../adapters/boltzmann-node");

      let result;
      if (isWabiSabi) {
        result = await computeBoltzmannWabiSabi(inputValues, outputValues, tx.fee, timeoutSeconds * 1000);
      } else if (jmFinding && typeof jmFinding.params?.denomination === "number") {
        result = await computeBoltzmannJoinMarket(
          inputValues, outputValues, tx.fee,
          jmFinding.params.denomination as number, 0.005, timeoutSeconds * 1000,
        );
      } else {
        result = await computeBoltzmann(inputValues, outputValues, tx.fee, 0.005, timeoutSeconds * 1000);
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            entropy: result.entropy,
            efficiency: result.efficiency,
            nbCombinations: result.nbCmbn,
            deterministicLinks: result.deterministicLinks,
            timedOut: result.timedOut,
            elapsedMs: result.elapsedMs,
            nInputs: result.nInputs,
            nOutputs: result.nOutputs,
          }, null, 2),
        }],
      };
    },
  );

  // ---- Start server ----

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("am-i-exposed MCP server started on stdio");
}

/** Build TxContext (same logic as scan-tx command). */
async function buildTxContext(
  tx: MempoolTransaction,
  client: ReturnType<typeof createMempoolClient>,
): Promise<TxContext> {
  const ctx: TxContext = {};
  const parentTxs = new Map<string, MempoolTransaction>();
  const txCounts = new Map<string, number>();
  const allFetches: Promise<void>[] = [];

  const parentTxids = new Set<string>();
  for (const vin of tx.vin) {
    if (!vin.is_coinbase && vin.txid) parentTxids.add(vin.txid);
  }
  for (const ptxid of parentTxids) {
    allFetches.push(
      client.getTransaction(ptxid).then((ptx) => { parentTxs.set(ptxid, ptx); }, () => {}),
    );
  }

  const outputAddresses = tx.vout
    .map((v) => v.scriptpubkey_address)
    .filter((a): a is string => !!a);
  if (outputAddresses.length <= 20) {
    for (const addr of outputAddresses) {
      allFetches.push(
        client.getAddress(addr).then(
          (d) => { txCounts.set(addr, d.chain_stats.tx_count + d.mempool_stats.tx_count); },
          () => {},
        ),
      );
    }
  }

  await Promise.all(allFetches);
  ctx.parentTxs = parentTxs;
  if (tx.vin[0] && !tx.vin[0].is_coinbase && tx.vin[0].txid) {
    ctx.parentTx = parentTxs.get(tx.vin[0].txid);
  }
  if (txCounts.size > 0) ctx.outputTxCounts = txCounts;
  return ctx;
}
