import type { ScoringResult, Finding } from "@/lib/types";
import type { PrimaryRec } from "@/lib/recommendations/primary-recommendation";
import type { WalletAuditResult } from "@/lib/analysis/wallet-audit";
import type { MempoolTransaction } from "@/lib/api/types";

const VERSION = "0.34.2";

interface JsonEnvelope {
  version: string;
  input: { type: string; value: string };
  network: string;
  score: number;
  grade: string;
  txType?: string;
  txInfo?: Record<string, unknown>;
  addressInfo?: Record<string, unknown>;
  walletInfo?: Record<string, unknown>;
  psbtInfo?: Record<string, unknown>;
  findings: Finding[];
  recommendation?: JsonRec | null;
  chainAnalysis?: unknown;
  boltzmann?: unknown;
  trace?: unknown;
  /** URLs to interactive visualizations on am-i.exposed */
  links?: Record<string, string>;
}

interface JsonRec {
  id: string;
  urgency: string;
  headline: string;
  detail: string;
  tools?: { name: string; url: string }[];
}

const BASE_URL = "https://am-i.exposed";

function buildLinks(type: string, value: string, network: string, apiUrl?: string): Record<string, string> {
  const mempoolBase = apiUrl
    ? apiUrl.replace(/\/api\/?$/, "")  // strip /api suffix to get the explorer base
    : "https://mempool.space";
  const networkPrefix = network === "mainnet" ? "" : `${network}/`;
  const links: Record<string, string> = {};

  if (type === "txid") {
    links.analysis = `${BASE_URL}/#tx=${value}`;
    links.mempool = `${mempoolBase}/${networkPrefix}tx/${value}`;
  } else if (type === "address") {
    links.analysis = `${BASE_URL}/#addr=${value}`;
    links.mempool = `${mempoolBase}/${networkPrefix}address/${value}`;
  } else if (type === "xpub") {
    links.analysis = `${BASE_URL}/#xpub=${encodeURIComponent(value)}`;
  }

  return links;
}

function recToJson(rec: PrimaryRec | null | undefined): JsonRec | null {
  if (!rec) return null;
  return {
    id: rec.id,
    urgency: rec.urgency,
    headline: rec.headlineDefault,
    detail: rec.detailDefault,
    tools: rec.tools ?? (rec.tool ? [rec.tool] : undefined),
  };
}

export function jsonOutput(data: JsonEnvelope): void {
  console.log(JSON.stringify(data, null, 2));
}

export function txJson(
  txid: string,
  result: ScoringResult,
  tx: MempoolTransaction,
  network: string,
  rec?: PrimaryRec | null,
  chainAnalysis?: unknown,
  apiUrl?: string,
): void {
  jsonOutput({
    version: VERSION,
    input: { type: "txid", value: txid },
    network,
    score: result.score,
    grade: result.grade,
    txType: result.txType,
    txInfo: {
      inputs: tx.vin.length,
      outputs: tx.vout.length,
      fee: tx.fee,
      size: tx.size,
      weight: tx.weight,
      confirmed: tx.status?.confirmed ?? false,
      blockHeight: tx.status?.block_height ?? null,
    },
    findings: result.findings,
    recommendation: recToJson(rec),
    chainAnalysis: chainAnalysis ?? null,
    links: buildLinks("txid", txid, network, apiUrl),
  });
}

export function addressJson(
  address: string,
  result: ScoringResult,
  network: string,
  addressInfo: Record<string, unknown>,
  rec?: PrimaryRec | null,
  apiUrl?: string,
): void {
  jsonOutput({
    version: VERSION,
    input: { type: "address", value: address },
    network,
    score: result.score,
    grade: result.grade,
    addressInfo,
    findings: result.findings,
    recommendation: recToJson(rec),
    links: buildLinks("address", address, network, apiUrl),
  });
}

export function walletJson(
  descriptor: string,
  result: WalletAuditResult,
  network: string,
  apiUrl?: string,
): void {
  jsonOutput({
    version: VERSION,
    input: { type: "xpub", value: descriptor },
    network,
    score: result.score,
    grade: result.grade,
    walletInfo: {
      activeAddresses: result.activeAddresses,
      totalTxs: result.totalTxs,
      totalUtxos: result.totalUtxos,
      totalBalance: result.totalBalance,
      reusedAddresses: result.reusedAddresses,
      dustUtxos: result.dustUtxos,
    },
    findings: result.findings,
    links: buildLinks("xpub", descriptor, network, apiUrl),
  });
}

export function psbtJson(
  input: string,
  result: ScoringResult,
  psbtInfo: Record<string, unknown>,
): void {
  jsonOutput({
    version: VERSION,
    input: { type: "psbt", value: input.length > 80 ? input.slice(0, 77) + "..." : input },
    network: "mainnet",
    score: result.score,
    grade: result.grade,
    txType: result.txType,
    psbtInfo,
    findings: result.findings,
  });
}
