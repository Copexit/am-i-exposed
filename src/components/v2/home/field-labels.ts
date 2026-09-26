import { DUST_THRESHOLD } from "@/lib/constants";
import { isRoundAmount } from "@/lib/analysis/heuristics/round-amount";
import { SCRIPT_CODES, type FieldTx } from "./field-data";

/**
 * Facts about one real UTXO of the hero's background CoinJoin. Every field is
 * read or counted from the transaction; nothing is guessed.
 * - anonSet: outputs only, number of outputs of this tx with exactly this value.
 * - round: the engine's own round-amount rule (H1 isRoundAmount: a multiple of
 *   10k, 100k, 1M or 10M sats).
 * - dust: value below DUST_THRESHOLD (1,000 sats).
 */
export interface FieldUtxo {
  side: "in" | "out";
  index: number;
  value: number;
  scriptType: string;
  anonSet: number;
  round: boolean;
  dust: boolean;
}

export type FieldLabelKind = "dust" | "anon-set" | "round" | "plain";

/** "v0_p2wpkh" -> "P2WPKH", "p2pkh" -> "P2PKH". */
export function scriptLabel(scriptType: string): string {
  return scriptType.replace(/^v\d_/, "").toUpperCase();
}

export function buildFieldUtxos(tx: FieldTx): FieldUtxo[] {
  const counts = new Map<number, number>();
  for (const v of tx.outValues) counts.set(v, (counts.get(v) ?? 0) + 1);
  const type = (codes: string, i: number) => SCRIPT_CODES[codes[i] as keyof typeof SCRIPT_CODES] ?? "unknown";
  const make = (side: "in" | "out", value: number, index: number, scriptType: string): FieldUtxo => ({
    side,
    index,
    value,
    scriptType,
    anonSet: side === "out" ? counts.get(value) ?? 0 : 0,
    round: isRoundAmount(value),
    dust: value < DUST_THRESHOLD,
  });
  return [
    ...tx.inValues.map((v, i) => make("in", v, i, type(tx.inTypes, i))),
    ...tx.outValues.map((v, i) => make("out", v, i, type(tx.outTypes, i))),
  ];
}

/** The most telling fact about a UTXO, which picks its label and color. */
export function labelKind(u: FieldUtxo): FieldLabelKind {
  if (u.dust) return "dust";
  if (u.anonSet >= 2) return "anon-set";
  if (u.round) return "round";
  return "plain";
}

/** Evenly spaced sample of `n` items, so every part of the tx is represented. */
export function sampleEvenly<T>(items: readonly T[], n: number): T[] {
  if (n >= items.length) return [...items];
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]!);
}
