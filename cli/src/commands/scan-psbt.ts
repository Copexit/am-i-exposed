import { existsSync, readFileSync } from "fs";
import { isPSBT } from "@/lib/bitcoin/psbt";
import { isValidNetwork } from "@/lib/bitcoin/networks";
import { parseLocalTx, isRawTxHex } from "@/lib/input/local-tx";
import { bytesToPayload } from "@/lib/input/file";
import { cleanInput } from "@/lib/analysis/detect-input";
import { runLocalAnalysis } from "@/lib/analysis/run-local-analysis";
import type { GlobalOpts } from "../index";
import { setJsonMode, startSpinner, succeedSpinner } from "../util/progress";
import { formatTxResult } from "../output/formatter";
import { psbtJson } from "../output/json";

export async function scanPsbt(
  input: string,
  opts: GlobalOpts,
): Promise<void> {
  const isJson = !!opts.json;
  setJsonMode(isJson);

  // Read input: file path (text or binary) or inline payload; line-wrapped payloads are unwrapped like the web
  const data = cleanInput(existsSync(input) ? bytesToPayload(readFileSync(input)) : input);

  if (!isPSBT(data) && !isRawTxHex(data)) {
    throw new Error(
      "Invalid input: expected a PSBT (base64/hex/binary) or a raw transaction (hex/binary)",
    );
  }

  startSpinner("Parsing transaction...");
  // Encode addresses for the selected network, like the web
  const network = opts.network ?? "mainnet";
  const local = parseLocalTx(data, isValidNetwork(network) ? network : "mainnet");

  // Offline: no lookup client; Boltzmann has no Worker in Node so it is skipped
  const { result, tx } = await runLocalAnalysis(local, {
    lookup: null,
    signal: new AbortController().signal,
    boltzmannTimeoutMs: 0,
    isCustomApi: false,
  });

  succeedSpinner("Analysis complete");

  // Build PSBT info
  const psbtInfo: Record<string, unknown> = {
    status: local.status,
    inputs: tx.vin.length,
    outputs: tx.vout.length,
    estimatedFee: tx.fee ?? null,
    estimatedVsize: tx.weight ? Math.ceil(tx.weight / 4) : null,
  };

  // Output
  if (isJson) {
    psbtJson(input, result, psbtInfo, network);
  } else {
    // Reuse tx formatter with a synthetic "PSBT" label
    console.log(formatTxResult(local.source === "psbt" ? "(PSBT)" : "(raw transaction)", result, tx, network));
  }
}
