/**
 * Spending checklist (guide, "Spending checklist"), the parts about the
 * recipient and the amount: which coins the recipient already knows (rule
 * 1), the alerts for a reused recipient, a round amount, a different address
 * type and leftover change (rules 3, 6, 7), and the round-change fee trick
 * (rule 8). Pure and local: the recipient address is never logged, stored or
 * sent from here.
 */
import { Address, NETWORK, TEST_NETWORK } from "@scure/btc-signer";
import type { Severity } from "@/lib/types";
import type { BitcoinNetwork } from "@/lib/bitcoin/networks";
import { getAddressType } from "@/lib/bitcoin/address-type";
import type { WalletAddressInfo } from "./wallet-audit";
import { buildWalletGraph, isOwn } from "./wallet-behavior";
import { isRoundAmount } from "./heuristics/round-amount";
import { outpointOf, type CoinSelectionInput, type CoinSelectionPlan } from "./coin-selection";

/** A valid address (checksum included) for the network. */
export function validRecipient(address: string, network: BitcoinNetwork): boolean {
  try {
    Address(network === "mainnet" ? NETWORK : TEST_NETWORK).decode(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Why the recipient knows a coin: it paid the wallet that coin ("sent"), the
 * coin is change of a payment to it ("paid"), the coin is already linked
 * on-chain to one of those ("linked", same certain cluster), or its label
 * names the same observer as one of those ("observer").
 */
export type KnownWhy = "sent" | "paid" | "linked" | "observer";

export interface RecipientHistory {
  /** Transactions in the wallet's history where the recipient address is an input */
  sent: number;
  /** The wallet's spends that paid the recipient address */
  paid: number;
  /** Unspent coins the recipient already knows, by outpoint */
  known: Map<string, KnownWhy>;
}

/** What the wallet's history says about a recipient address (local, no requests). */
export function recipientHistory(infos: readonly WalletAddressInfo[], coins: readonly CoinSelectionInput[], recipient: string): RecipientHistory {
  const g = buildWalletGraph(infos);
  const known = new Map<string, KnownWhy>();
  const sentTx = new Set<string>();
  const paidTx = new Set<string>();
  for (const tx of g.txs.values()) {
    if (tx.vin.some((v) => v.prevout?.scriptpubkey_address === recipient)) sentTx.add(tx.txid);
    else if (tx.vout.some((o) => o.scriptpubkey_address === recipient) && tx.vin.some((v) => isOwn(g, v.prevout?.scriptpubkey_address))) paidTx.add(tx.txid);
  }
  // Paying one of the wallet's own addresses: nobody outside learns anything, so no coin is "known".
  if (g.own.has(recipient)) return { sent: sentTx.size, paid: paidTx.size, known };
  for (const c of coins) {
    // A CoinJoin the recipient took part in does not tell it which mixed output is yours.
    if (sentTx.has(c.utxo.txid) && c.origin !== "mixed") known.set(outpointOf(c), "sent");
    else if (paidTx.has(c.utxo.txid)) known.set(outpointOf(c), "paid");
  }
  const direct = coins.filter((c) => known.has(outpointOf(c)));
  const clusters = new Set(direct.map((c) => c.cluster).filter((x) => x !== undefined));
  const observers = new Set(direct.map((c) => c.labelObserver?.trim().toLowerCase()).filter((x) => !!x));
  for (const c of coins) {
    const k = outpointOf(c);
    if (known.has(k)) continue;
    if (c.cluster !== undefined && clusters.has(c.cluster)) known.set(k, "linked");
    else if (c.labelObserver && observers.has(c.labelObserver.trim().toLowerCase())) known.set(k, "observer");
  }
  return { sent: sentTx.size, paid: paidTx.size, known };
}

/** The wallet's address type: the most common among its coins, or null with no coins. */
export function walletAddressType(coins: readonly CoinSelectionInput[]): string | null {
  const counts = new Map<string, number>();
  for (const c of coins) {
    const t = getAddressType(c.address);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [t, n] of counts) if (best === null || n > counts.get(best)!) best = t;
  return best === "unknown" ? null : best;
}

export type SpendAlertId = "reused-history" | "reused-api" | "round" | "type-mismatch" | "change-tips";

export interface SpendAlert {
  id: SpendAlertId;
  severity: Severity;
  /** reused-history: past payments from / to the address; round: the amount; type-mismatch: the two types */
  sent?: number;
  paid?: number;
  amount?: number;
  to?: string;
  from?: string;
}

/**
 * Alerts above the plans, most severe first: reused recipient (rule 6),
 * round amount and address-type mismatch (rule 7, both reveal the change by
 * the W3 rules) and what to do with change (rule 3).
 */
export function spendingAlerts({ amount, recipient, walletType, history, apiReused, change }: {
  amount: number;
  /** Valid recipient address, or null */
  recipient: string | null;
  walletType: string | null;
  history: RecipientHistory | null;
  /** The explicit reuse check's answer for this recipient (true: used before), or null when not asked */
  apiReused: boolean | null;
  /** Change of the top plan (0 when changeless) */
  change: number;
}): SpendAlert[] {
  const alerts: SpendAlert[] = [];
  if (history && (history.sent > 0 || history.paid > 0)) alerts.push({ id: "reused-history", severity: "critical", sent: history.sent, paid: history.paid });
  else if (apiReused) alerts.push({ id: "reused-api", severity: "critical" });
  if (isRoundAmount(amount)) alerts.push({ id: "round", severity: "medium", amount });
  const to = recipient ? getAddressType(recipient) : "unknown";
  if (walletType && to !== "unknown" && to !== walletType) alerts.push({ id: "type-mismatch", severity: "medium", to, from: walletType });
  if (change > 0) alerts.push({ id: "change-tips", severity: "low" });
  return alerts;
}

/** The smallest multiple the round-amount rule (W3, isRoundAmount) counts as round. */
export const ROUND_STEP = 10_000;
/** The round-change nudge is at most this share of the payment, and at most the max extra fee. */
export const ROUND_CHANGE_SHARE = 0.05;

export const roundChangeCap = (payment: number, maxAbsorb: number) => Math.min(maxAbsorb, Math.floor(ROUND_CHANGE_SHARE * payment));

/**
 * Rule 8: when the payment is round and the plan leaves change, the fee
 * nudged up so the change is round too (a multiple of ROUND_STEP), so the
 * round-amount rule cannot tell payment from change. Null when the payment
 * is not round, there is no change, the change is already round or below
 * ROUND_STEP, or the nudge is past roundChangeCap.
 */
export function roundChange(plan: CoinSelectionPlan, maxAbsorb: number): { extra: number; change: number; fee: number } | null {
  if (plan.change === 0 || !isRoundAmount(plan.paymentAmount)) return null;
  const extra = plan.change % ROUND_STEP;
  const change = plan.change - extra;
  if (extra === 0 || change < ROUND_STEP || extra > roundChangeCap(plan.paymentAmount, maxAbsorb)) return null;
  return { extra, change, fee: plan.fee + extra };
}
