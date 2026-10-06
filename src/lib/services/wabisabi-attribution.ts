import { ApiError } from "@/lib/api/fetch-with-retry";
import { serviceRpc } from "./client";
import type { LookupConsent } from "./consent";

export interface RoundRef { txid: string; coordinator: string; name: string; time: number; btc: number }
export interface CoinRef { roundTxid: string; coordinator: string; name: string; time: number; index: number; sats: number }
export type TxAttribution =
  | { kind: "coinjoin"; txid: string; coordinator: { key: string; name: string }; roundId: string; time: number;
      isBlame: boolean; feeRate: number; inputs: number; outputs: number; anonsetIn: number; anonsetOut: number;
      freshBtc: number; inputOrigins: { fresh: number; remix: number; other: number };
      remixFrom: { coordinator: string; name: string; btc: number; coins: number }[];
      remixedFromRounds: RoundRef[]; remixedIntoRounds: RoundRef[]; nonStandardOutputs: number }
  | { kind: "linked"; txid: string; outOf: CoinRef[]; into: CoinRef[] }
  | { kind: "none"; txid: string }
  | { kind: "error"; txid: string; message: string };

export interface AttributionCtx { isUmbrel: boolean; signal?: AbortSignal; consent: LookupConsent }

interface WabiLink { CoinjoinTxId: string; Coordinator: string; Name: string; Time: number; Vin?: number; Vout?: number; Value: number }
interface WabiSearchResult {
  Matches?: { Kind: string; TxId: string }[];
  Transaction?: { OutOf?: WabiLink[]; Into?: WabiLink[] } | null;
}
interface WabiRound { TxId: string; Coordinator: string; Name: string; Time: number; Btc: number; Coins: number }
interface WabiCoinjoinResult {
  Coinjoin: {
    RoundId: string; IsBlame: boolean; FinalMiningFeeRate: number; InputCount: number; OutputCount: number;
    AverageStandardInputsAnonSet: number; AverageStandardOutputsAnonSet: number; FreshInputsEstimateBtc: number;
    Coordinator: string; CoordinatorName: string; RoundEndTime?: string;
  };
  RemixedFrom?: WabiRound[];
  RemixedInto?: WabiRound[];
  Transaction: { Inputs?: { Origin?: string }[]; Outputs?: { Standard?: boolean }[]; BlockTime?: number };
}

const toRound = (r: WabiRound): RoundRef => ({ txid: r.TxId, coordinator: r.Coordinator, name: r.Name, time: r.Time, btc: r.Btc });
const toCoins = (l: WabiLink[] | undefined, idx: "Vin" | "Vout"): CoinRef[] =>
  (l ?? []).map((c) => ({ roundTxid: c.CoinjoinTxId, coordinator: c.Coordinator, name: c.Name, time: c.Time, index: c[idx] ?? 0, sats: c.Value }));

function mapCoinjoin(txid: string, r: WabiCoinjoinResult): TxAttribution {
  const cj = r.Coinjoin;
  const origins = { fresh: 0, remix: 0, other: 0 };
  for (const i of r.Transaction.Inputs ?? []) origins[i.Origin === "fresh" || i.Origin === "remix" ? i.Origin : "other"]++;
  const byCoord = new Map<string, { coordinator: string; name: string; btc: number; coins: number }>();
  for (const f of r.RemixedFrom ?? []) {
    const g = byCoord.get(f.Coordinator) ?? { coordinator: f.Coordinator, name: f.Name, btc: 0, coins: 0 };
    g.btc += f.Btc;
    g.coins += f.Coins;
    byCoord.set(f.Coordinator, g);
  }
  const iso = cj.RoundEndTime ? Date.parse(cj.RoundEndTime) : NaN;
  return {
    kind: "coinjoin", txid,
    coordinator: { key: cj.Coordinator, name: cj.CoordinatorName },
    roundId: cj.RoundId,
    time: Number.isFinite(iso) ? Math.floor(iso / 1000) : (r.Transaction.BlockTime ?? 0),
    isBlame: cj.IsBlame, feeRate: cj.FinalMiningFeeRate,
    inputs: cj.InputCount, outputs: cj.OutputCount,
    anonsetIn: cj.AverageStandardInputsAnonSet, anonsetOut: cj.AverageStandardOutputsAnonSet,
    freshBtc: cj.FreshInputsEstimateBtc, inputOrigins: origins,
    remixFrom: [...byCoord.values()].sort((a, b) => b.btc - a.btc),
    remixedFromRounds: (r.RemixedFrom ?? []).map(toRound),
    remixedIntoRounds: (r.RemixedInto ?? []).map(toRound),
    nonStandardOutputs: (r.Transaction.Outputs ?? []).filter((o) => o.Standard === false).length,
  };
}

export async function lookupTx(txid: string, ctx: AttributionCtx): Promise<TxAttribution> {
  const opts = { isUmbrel: ctx.isUmbrel, signal: ctx.signal, consent: ctx.consent };
  try {
    const s = await serviceRpc<WabiSearchResult>("wabisator", "/api.php", "search", { query: txid }, opts);
    if (s.Matches?.some((m) => m.Kind === "coinjoin" && m.TxId === txid)) {
      const cj = await serviceRpc<WabiCoinjoinResult>("wabisator", "/api.php", "coinjoin", { txId: txid }, opts);
      return mapCoinjoin(txid, cj);
    }
    const t = s.Transaction;
    if (t?.OutOf?.length || t?.Into?.length) {
      return { kind: "linked", txid, outOf: toCoins(t.OutOf, "Vin"), into: toCoins(t.Into, "Vout") };
    }
    return { kind: "none", txid };
  } catch (err) {
    if (ctx.signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) throw err;
    const message = err instanceof ApiError || err instanceof Error ? err.message : "Lookup failed";
    return { kind: "error", txid, message };
  }
}

type Group = { coordinator: string; name: string; sats: number; coins: number };
export interface AttributionSummary {
  checked: number; failed: number;
  rounds: Extract<TxAttribution, { kind: "coinjoin" }>[];
  outOf: Group[];
  into: Group[];
  postMixMerges: { txid: string; coins: number; rounds: number }[];
  linked: Extract<TxAttribution, { kind: "linked" }>[];
}

function group(coins: CoinRef[]): Group[] {
  const m = new Map<string, Group>();
  for (const c of coins) {
    const g = m.get(c.coordinator) ?? { coordinator: c.coordinator, name: c.name, sats: 0, coins: 0 };
    g.sats += c.sats;
    g.coins++;
    m.set(c.coordinator, g);
  }
  return [...m.values()].sort((a, b) => b.sats - a.sats);
}

/** isLocalCoinJoin: txids our own engine classifies as CoinJoins (excluded from postMixMerges). */
export function summarize(results: TxAttribution[], isLocalCoinJoin: (txid: string) => boolean): AttributionSummary {
  const rounds = results.filter((r): r is Extract<TxAttribution, { kind: "coinjoin" }> => r.kind === "coinjoin");
  const linked = results.filter((r): r is Extract<TxAttribution, { kind: "linked" }> => r.kind === "linked");
  const failed = results.filter((r) => r.kind === "error").length;
  return {
    checked: results.length - failed, failed, rounds,
    outOf: group(linked.flatMap((l) => l.outOf)),
    into: group(linked.flatMap((l) => l.into)),
    postMixMerges: linked
      .filter((l) => l.outOf.length >= 2 && !isLocalCoinJoin(l.txid))
      .map((l) => ({ txid: l.txid, coins: l.outOf.length, rounds: new Set(l.outOf.map((c) => c.roundTxid)).size })),
    linked,
  };
}

export const ADDRESS_CAP = 10;
export const WALLET_CAP = 50;

/** Newest first (unconfirmed first), deduplicated, capped. */
export function selectTxids(txs: { txid: string; status?: { block_time?: number } }[], cap: number): string[] {
  const seen = new Set<string>();
  return txs
    .filter((t) => !seen.has(t.txid) && seen.add(t.txid))
    .sort((a, b) => (b.status?.block_time ?? Infinity) - (a.status?.block_time ?? Infinity))
    .slice(0, cap)
    .map((t) => t.txid);
}
