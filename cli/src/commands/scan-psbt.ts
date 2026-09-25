import { existsSync, readFileSync } from "fs";
import { parsePSBT, isPSBT } from "@/lib/bitcoin/psbt";
import { isValidNetwork } from "@/lib/bitcoin/networks";
import { analyzeTransaction } from "@/lib/analysis/orchestrator";
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

  // Read input: file path or raw base64
  let psbtData: string;
  if (existsSync(input)) {
    psbtData = readFileSync(input, "utf-8").trim();
  } else {
    psbtData = input.trim();
  }

  if (!isPSBT(psbtData)) {
    throw new Error(
      "Invalid PSBT: input is not a valid PSBT (expected base64 or hex format)",
    );
  }

  startSpinner("Parsing PSBT...");
  // Encode addresses for the selected network, like the web
  const network = opts.network ?? "mainnet";
  const parsed = parsePSBT(psbtData, isValidNetwork(network) ? network : undefined);

  // Analyze the parsed transaction
  const result = await analyzeTransaction(parsed.tx);

  succeedSpinner("PSBT analysis complete");

  // Build PSBT info
  const psbtInfo: Record<string, unknown> = {
    inputs: parsed.tx.vin.length,
    outputs: parsed.tx.vout.length,
    estimatedFee: parsed.tx.fee ?? null,
    estimatedVsize: parsed.tx.weight ? Math.ceil(parsed.tx.weight / 4) : null,
  };

  // Output
  if (isJson) {
    psbtJson(input, result, psbtInfo, network);
  } else {
    // Reuse tx formatter with a synthetic "PSBT" label
    console.log(formatTxResult("(PSBT - unsigned)", result, parsed.tx, network));
  }
}
