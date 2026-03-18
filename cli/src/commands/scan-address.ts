import { analyzeAddress } from "@/lib/analysis/orchestrator";
import {
  selectRecommendations,
  type RecommendationContext,
} from "@/lib/recommendations/primary-recommendation";
import { getAddressType } from "@/lib/bitcoin/address-type";
import { createClient } from "../util/api";
import type { GlobalOpts } from "../index";
import {
  setJsonMode,
  startSpinner,
  updateSpinner,
  succeedSpinner,
} from "../util/progress";
import { formatAddressResult } from "../output/formatter";
import { addressJson } from "../output/json";

export async function scanAddress(
  addr: string,
  opts: GlobalOpts,
): Promise<void> {
  const isJson = !!opts.json;
  setJsonMode(isJson);

  // Validate address
  const addrType = getAddressType(addr);
  if (addrType === "unknown") {
    throw new Error(`Invalid Bitcoin address: "${addr}"`);
  }

  // Network consistency check
  const network = opts.network ?? "mainnet";
  if (network === "mainnet" && (addr.startsWith("tb1") || addr.startsWith("2") || addr.startsWith("m") || addr.startsWith("n"))) {
    throw new Error(
      `Address "${addr}" appears to be testnet but --network is mainnet`,
    );
  }

  const client = createClient(opts);

  // Fetch address data
  startSpinner("Fetching address data...");
  const [addressData, utxos, txs] = await Promise.all([
    client.getAddress(addr),
    client.getAddressUtxos(addr),
    client.getAddressTxs(addr),
  ]);

  // Run analysis
  updateSpinner("Running heuristic analysis...");
  const result = await analyzeAddress(addressData, utxos, txs);

  // Recommendation
  const recCtx: RecommendationContext = {
    findings: result.findings,
    grade: result.grade,
    walletGuess: null,
  };
  const [primary] = selectRecommendations(recCtx);

  succeedSpinner("Analysis complete");

  // Output
  if (isJson) {
    addressJson(addr, result, network, {
      type: addrType,
      txCount:
        addressData.chain_stats.tx_count +
        addressData.mempool_stats.tx_count,
      fundedTxoCount:
        addressData.chain_stats.funded_txo_count +
        addressData.mempool_stats.funded_txo_count,
      spentTxoCount:
        addressData.chain_stats.spent_txo_count +
        addressData.mempool_stats.spent_txo_count,
      balance:
        addressData.chain_stats.funded_txo_sum -
        addressData.chain_stats.spent_txo_sum +
        addressData.mempool_stats.funded_txo_sum -
        addressData.mempool_stats.spent_txo_sum,
    }, primary, opts.api);
  } else {
    console.log(formatAddressResult(addr, result, network, primary));
  }
}
