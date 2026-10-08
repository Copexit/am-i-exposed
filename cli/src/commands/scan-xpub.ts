import { parseXpub, type ParsedXpub } from "@/lib/bitcoin/descriptor";
import { auditWallet, type WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import { scanChain, walletChains } from "@/lib/wallet/scan";
import type { MempoolClient } from "@/lib/api/mempool";
import { createClient } from "../util/api";
import type { GlobalOpts } from "../index";
import {
  setJsonMode,
  startSpinner,
  updateSpinner,
  succeedSpinner,
} from "../util/progress";
import { formatWalletResult } from "../output/formatter";
import { walletJson } from "../output/json";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { MAX_FILE_BYTES, parseBip329, serializeBip329, type Bip329Record } from "@/lib/wallet/bip329";
import { autoLabels, exportRecords, matchLabels } from "@/lib/wallet/labels";

export interface LabelsSummary {
  applied: number;
  unmatched: number;
  invalid: number;
  truncated: number;
  /** Unspent coins marked spendable: false */
  frozen: number;
  /** Records written by --export-labels */
  exported?: number;
}

/**
 * --labels <file>: read BIP329 labels and match them to the scanned wallet.
 * --export-labels <file>: write the labels back with automatic aie: labels
 * (lib/wallet/labels exportRecords). Files stay local; nothing is sent.
 */
export function walletLabelFiles(
  addresses: WalletAddressInfo[],
  xpub: string,
  { labels, exportLabels }: { labels?: string; exportLabels?: string },
): LabelsSummary | null {
  if (!labels && !exportLabels) return null;
  let records: Bip329Record[] = [];
  const summary: LabelsSummary = { applied: 0, unmatched: 0, invalid: 0, truncated: 0, frozen: 0 };
  if (labels) {
    if (statSync(labels).size > MAX_FILE_BYTES) throw new Error(`Labels file larger than ${MAX_FILE_BYTES / 1024 / 1024} MB: ${labels}`);
    const parsed = parseBip329(readFileSync(labels, "utf8"));
    if (!parsed) throw new Error(`Labels file larger than ${MAX_FILE_BYTES / 1024 / 1024} MB: ${labels}`);
    records = parsed.records;
    const m = matchLabels(records, addresses, xpub);
    Object.assign(summary, {
      applied: m.applied, unmatched: m.unmatched, invalid: parsed.invalid, truncated: parsed.truncated,
      frozen: [...m.coins.values()].filter((c) => c.frozen).length,
    });
  }
  if (exportLabels) {
    const out = exportRecords(records, autoLabels(addresses));
    writeFileSync(exportLabels, serializeBip329(out), { mode: 0o600 });
    summary.exported = out.length;
  }
  return summary;
}

export async function scanXpub(
  descriptor: string,
  opts: GlobalOpts,
): Promise<void> {
  const isJson = !!opts.json;
  setJsonMode(isJson);

  const gapLimit = Number(opts.gapLimit ?? opts["gap-limit"] ?? 20);
  const network = opts.network ?? "mainnet";
  const client = createClient(opts);

  // Parse descriptor
  startSpinner("Parsing descriptor...");
  const parsed = parseXpub(descriptor);

  // A custom --api is usually the user's own node: no hosted-API throttle
  const { addresses: allAddresses, failed } = await scanWalletAddresses(client, parsed, gapLimit, {
    isLocal: !!opts.api,
    onProgress: updateSpinner,
  });

  // Run wallet audit
  updateSpinner("Running wallet audit...");
  const result = auditWallet(allAddresses, failed);
  const labels = walletLabelFiles(allAddresses, parsed.xpub, {
    labels: opts.labels as string | undefined,
    exportLabels: (opts.exportLabels ?? opts["export-labels"]) as string | undefined,
  });

  succeedSpinner(
    `Wallet audit complete (${result.activeAddresses} active addresses)`,
  );
  if (failed.length > 0) {
    console.error(`Warning: ${failed.length} address(es) could not be fetched, the audit may be incomplete: ${failed.join(", ")}`);
  }

  // Output
  if (isJson) {
    walletJson(descriptor, result, network, opts.api, failed, labels);
  } else {
    console.log(formatWalletResult(descriptor, result, network));
    if (labels) {
      const parts = [];
      if (opts.labels) parts.push(`${labels.applied} applied, ${labels.unmatched} not matching this wallet, ${labels.invalid} invalid${labels.frozen ? `, ${labels.frozen} frozen coins` : ""}`);
      if (labels.exported !== undefined) parts.push(`${labels.exported} written to ${String(opts.exportLabels ?? opts["export-labels"])}`);
      console.log(`Labels: ${parts.join("; ")}`);
    }
  }
}

/**
 * Scan the wallet's chains (external = 0, internal = 1, or only the one a
 * descriptor fixes) with the web wallet scan
 * (scanChain): a failed address fetch is retried, then reported in `failed`
 * and never counted as unused. Shared by the scan xpub command and MCP scan_wallet.
 * Rejects with an AbortError once `signal` aborts.
 */
export async function scanWalletAddresses(
  client: MempoolClient,
  parsed: ParsedXpub,
  gapLimit: number,
  {
    isLocal,
    onProgress = () => {},
    signal = new AbortController().signal,
  }: { isLocal: boolean; onProgress?: (msg: string) => void; signal?: AbortSignal },
): Promise<{ addresses: WalletAddressInfo[]; failed: string[] }> {
  const addresses: WalletAddressInfo[] = [];
  const failed: string[] = [];

  for (const chain of walletChains(parsed)) {
    signal.throwIfAborted();
    const chainLabel = chain === 0 ? "external" : "internal";
    const res = await scanChain(parsed, chain, client, signal, isLocal, gapLimit, (info) =>
      onProgress(`Scanning ${chainLabel} chain: index ${info.derived.index}`),
    );
    addresses.push(...res.infos);
    failed.push(...res.failed);
  }
  signal.throwIfAborted();

  return { addresses, failed };
}
