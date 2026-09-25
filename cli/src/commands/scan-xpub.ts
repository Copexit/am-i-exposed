import { parseXpub, type ParsedXpub } from "@/lib/bitcoin/descriptor";
import { auditWallet, type WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import { scanChain } from "@/lib/wallet/scan";
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

  succeedSpinner(
    `Wallet audit complete (${result.activeAddresses} active addresses)`,
  );
  if (failed.length > 0) {
    console.error(`Warning: ${failed.length} address(es) could not be fetched, the audit may be incomplete: ${failed.join(", ")}`);
  }

  // Output
  if (isJson) {
    walletJson(descriptor, result, network, opts.api, failed);
  } else {
    console.log(formatWalletResult(descriptor, result, network));
  }
}

/**
 * Scan both chains (external = 0, internal = 1) with the web wallet scan
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

  for (const chain of [0, 1] as const) {
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
