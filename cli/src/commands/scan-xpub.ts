import { parseXpub, deriveOneAddress } from "@/lib/bitcoin/descriptor";
import { auditWallet, type WalletAddressInfo } from "@/lib/analysis/wallet-audit";
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

  // Scan both chains (external = 0, internal = 1)
  const allAddresses: WalletAddressInfo[] = [];

  for (const chain of [0, 1]) {
    const chainLabel = chain === 0 ? "external" : "internal";
    let consecutiveEmpty = 0;

    for (let index = 0; consecutiveEmpty < gapLimit; index++) {
      updateSpinner(
        `Scanning ${chainLabel} chain: index ${index} (gap ${consecutiveEmpty}/${gapLimit})`,
      );

      const derived = deriveOneAddress(parsed, chain, index);
      const addr = derived.address;

      // Fetch address data with rate limiting
      // Batch of 3 concurrent requests for hosted APIs
      let addressData = null;
      let txs: Awaited<ReturnType<typeof client.getAddressTxs>> = [];
      let utxos: Awaited<ReturnType<typeof client.getAddressUtxos>> = [];

      try {
        [addressData, txs, utxos] = await Promise.all([
          client.getAddress(addr),
          client.getAddressTxs(addr),
          client.getAddressUtxos(addr),
        ]);
      } catch {
        // Skip failed addresses
      }

      const txCount = addressData
        ? addressData.chain_stats.tx_count +
          addressData.mempool_stats.tx_count
        : 0;

      if (txCount === 0) {
        consecutiveEmpty++;
      } else {
        consecutiveEmpty = 0;
      }

      allAddresses.push({
        derived,
        addressData,
        txs,
        utxos,
      });

      // Rate limit: small delay between batches for hosted APIs
      if (index % 3 === 2) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  // Run wallet audit
  updateSpinner("Running wallet audit...");
  const result = auditWallet(allAddresses);

  succeedSpinner(
    `Wallet audit complete (${result.activeAddresses} active addresses)`,
  );

  // Output
  if (isJson) {
    walletJson(descriptor, result, network, opts.api);
  } else {
    console.log(formatWalletResult(descriptor, result, network));
  }
}
