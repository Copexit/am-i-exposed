/**
 * MCP (Model Context Protocol) server for am-i-exposed.
 *
 * Exposes the Bitcoin privacy analysis engine as structured tools
 * over stdio. Agents connect via MCP instead of shelling out to the CLI.
 * Each tool runs the same pipeline as the matching CLI command.
 *
 * CRITICAL: Never use console.log() here - it corrupts the JSON-RPC stream.
 * Use console.error() for debug output.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { analyzeTransaction, analyzeAddress } from "@/lib/analysis/orchestrator";
import { selectRecommendations } from "@/lib/recommendations/primary-recommendation";
import { DEFAULT_ANALYSIS_SETTINGS } from "@/lib/analysis/settings";
import { getAddressType } from "@/lib/bitcoin/address-type";
import { parsePSBT, isPSBT } from "@/lib/bitcoin/psbt";
import { parseXpub } from "@/lib/bitcoin/descriptor";
import { auditWallet } from "@/lib/analysis/wallet-audit";
import { initEntityFilter } from "../adapters/entity-loader";
import { createClient } from "../util/api";
import { VERSION } from "../output/json";
import { analyzeTxid } from "../commands/scan-tx";
import { scanWalletAddresses } from "../commands/scan-xpub";
import { boltzmannForTx, DEFAULT_INTRAFEES_RATIO } from "../commands/boltzmann";

const network = z.enum(["mainnet", "testnet4", "signet"]).default("mainnet");

/** Same client as the CLI (SQLite-cached, network-aware base URL). */
function mcpClient(net: string, apiUrl?: string) {
  return createClient({ network: net, api: apiUrl, entities: true, cache: true, color: false });
}

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** Build the MCP server with all tools registered (not yet connected). */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "am-i-exposed",
    version: VERSION,
  });

  // ---- scan_transaction ----

  server.tool(
    "scan_transaction",
    "Analyze a Bitcoin transaction for privacy exposure. Runs the transaction heuristics including CoinJoin detection, change detection, wallet fingerprinting, entity detection, and entropy analysis. Set chainDepth > 0 to add chain analysis (its findings count toward the grade).",
    {
      txid: z.string().regex(/^[0-9a-fA-F]{64}$/).describe("64-character hex transaction ID"),
      network: network.describe("Bitcoin network"),
      apiUrl: z.string().optional().describe("Custom mempool API URL"),
      fast: z.boolean().default(false).describe("Skip parent tx fetching for faster analysis"),
      chainDepth: z.number().int().min(0).default(0)
        .describe("Chain analysis hops. 0 skips all chain modules, so the grade can differ from the web scan"),
      minSats: z.number().int().min(0).default(DEFAULT_ANALYSIS_SETTINGS.minSats)
        .describe("Minimum satoshi value to follow when tracing"),
    },
    async ({ txid, network, apiUrl, fast, chainDepth, minSats }) => {
      const { result, primary, chainAnalysis } = await analyzeTxid(
        mcpClient(network, apiUrl), txid, { fast, chainDepth, minSats },
      );
      return textResult({
        score: result.score, grade: result.grade, txType: result.txType,
        findings: result.findings,
        recommendation: primary ? { id: primary.id, urgency: primary.urgency, headline: primary.headlineDefault } : null,
        chainAnalysis,
      });
    },
  );

  // ---- scan_address ----

  server.tool(
    "scan_address",
    "Analyze a Bitcoin address for privacy exposure. Checks address reuse, UTXO hygiene, spending patterns, entity identification, and temporal correlation.",
    {
      address: z.string().describe("Bitcoin address (any format)"),
      network,
      apiUrl: z.string().optional(),
    },
    async ({ address, network, apiUrl }) => {
      if (getAddressType(address) === "unknown") {
        throw new Error(`Invalid Bitcoin address: "${address}"`);
      }
      const client = mcpClient(network, apiUrl);
      const [addressData, utxos, txs] = await Promise.all([
        client.getAddress(address),
        client.getAddressUtxos(address),
        client.getAddressTxs(address),
      ]);
      const result = await analyzeAddress(addressData, utxos, txs);
      const [rec] = selectRecommendations({
        findings: result.findings, grade: result.grade, walletGuess: null,
      });

      return textResult({
        score: result.score, grade: result.grade,
        addressType: getAddressType(address),
        findings: result.findings,
        recommendation: rec ? { id: rec.id, urgency: rec.urgency, headline: rec.headlineDefault } : null,
      });
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

      return textResult({
        score: result.score, grade: result.grade, txType: result.txType,
        inputs: parsed.tx.vin.length,
        outputs: parsed.tx.vout.length,
        estimatedFee: parsed.tx.fee ?? null,
        findings: result.findings,
      });
    },
  );

  // ---- scan_wallet ----

  server.tool(
    "scan_wallet",
    "Audit wallet privacy via extended public key or output descriptor. Derives addresses, scans activity, and checks address reuse, UTXO hygiene, and consolidation patterns.",
    {
      descriptor: z.string().describe("xpub, zpub, ypub, or output descriptor"),
      network,
      apiUrl: z.string().optional(),
      gapLimit: z.number().default(20).describe("Consecutive unused addresses before stopping"),
    },
    async ({ descriptor, network, apiUrl, gapLimit }) => {
      const { addresses, failed } = await scanWalletAddresses(
        mcpClient(network, apiUrl), parseXpub(descriptor), gapLimit, { isLocal: !!apiUrl },
      );
      const result = auditWallet(addresses);
      return textResult({
        score: result.score, grade: result.grade,
        activeAddresses: result.activeAddresses,
        totalTxs: result.totalTxs,
        totalUtxos: result.totalUtxos,
        totalBalance: result.totalBalance,
        reusedAddresses: result.reusedAddresses,
        dustUtxos: result.dustUtxos,
        failedAddresses: failed,
        findings: result.findings,
      });
    },
  );

  // ---- compute_boltzmann ----

  server.tool(
    "compute_boltzmann",
    "Compute Boltzmann entropy, wallet efficiency, and link probability matrix for a transaction. Requires 2+ inputs. Auto-detects WabiSabi/JoinMarket for turbo mode.",
    {
      txid: z.string().regex(/^[0-9a-fA-F]{64}$/),
      network,
      apiUrl: z.string().optional(),
      timeoutSeconds: z.number().default(DEFAULT_ANALYSIS_SETTINGS.boltzmannTimeout),
    },
    async ({ txid, network, apiUrl, timeoutSeconds }) => {
      const tx = await mcpClient(network, apiUrl).getTransaction(txid);
      const result = await boltzmannForTx(tx, DEFAULT_INTRAFEES_RATIO, timeoutSeconds * 1000);
      return textResult({
        entropy: result.entropy,
        efficiency: result.efficiency,
        nbCombinations: result.nbCmbn,
        deterministicLinks: result.deterministicLinks,
        timedOut: result.timedOut,
        elapsedMs: result.elapsedMs,
        nInputs: result.nInputs,
        nOutputs: result.nOutputs,
      });
    },
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  // Load entity filter once at startup
  await initEntityFilter();
  await createMcpServer().connect(new StdioServerTransport());
  console.error("am-i-exposed MCP server started on stdio");
}
