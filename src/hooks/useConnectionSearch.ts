"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MempoolTransaction } from "@/lib/api/types";
import type { BitcoinNetwork } from "@/lib/bitcoin/networks";
import { cleanInput, detectInputType } from "@/lib/analysis/detect-input";
import { validRecipient } from "@/lib/analysis/spending-advice";
import { isCoinJoinTx } from "@/lib/analysis/heuristics/coinjoin";
import {
  findConnections,
  type ConnectionPath,
  type ConnectionProgress,
  type ConnectionSearchOptions,
  type SearchSummary,
} from "@/lib/graph/connection-search";
import type { GraphExpansionFetcher } from "@/lib/graph/graph-reducer";

export type Endpoint = { kind: "txid" | "address"; value: string };

/** A txid, or an address valid for `network`; null when the input is neither. */
export function parseEndpoint(input: string, network: BitcoinNetwork): Endpoint | null {
  const value = cleanInput(input);
  const type = detectInputType(value, network);
  if (type === "txid") return { kind: "txid", value: value.toLowerCase() };
  if (type === "address" && validRecipient(value, network)) return { kind: "address", value };
  return null;
}

export type ConnectionSearchStatus = "idle" | "running" | "done";

export interface ConnectionSearchState {
  status: ConnectionSearchStatus;
  results: ConnectionPath[];
  progress: ConnectionProgress | null;
  summary: SearchSummary | null;
  /** Set when an address endpoint could not be resolved (request failed or no history). */
  resolveError: "failed" | "empty" | null;
}

const IDLE: ConnectionSearchState = { status: "idle", results: [], progress: null, summary: null, resolveError: null };

/**
 * Runs findConnections through the graph's fetcher (response cache + retry).
 * Every tx the search fetches is kept in `txs` for scoring and adding paths.
 */
export function useConnectionSearch(fetcher: GraphExpansionFetcher | null) {
  const [state, setState] = useState<ConnectionSearchState>(IDLE);
  const [txs, setTxs] = useState<ReadonlyMap<string, MempoolTransaction>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  // Unmount: abort and drop the ref, so the finishing search writes no state
  useEffect(() => () => { abortRef.current?.abort(); abortRef.current = null; }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const start = useCallback(async (from: Endpoint, to: Endpoint, options: ConnectionSearchOptions) => {
    if (!fetcher) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const { signal } = ac;
    const seen = new Map<string, MempoolTransaction>();
    setTxs(seen);
    setState({ ...IDLE, status: "running" });

    const resolve = async (e: Endpoint): Promise<string[] | "failed"> => {
      if (e.kind === "txid") return [e.value];
      if (!fetcher.getAddressTxs) return "failed";
      try {
        // First page of history only. The client takes no signal here: an abort drops the result below.
        const list = await fetcher.getAddressTxs(e.value, 1);
        for (const tx of list) seen.set(tx.txid, tx);
        return list.map((tx) => tx.txid);
      } catch {
        return "failed";
      }
    };
    const [a, b] = await Promise.all([resolve(from), resolve(to)]);
    if (abortRef.current !== ac) return;
    if (signal.aborted) {
      setState({ ...IDLE, status: "done", summary: { txsFetched: 0, stoppedBy: "aborted", branchLimited: 0, coinJoinStops: 0, fetchErrors: 0 } });
      return;
    }
    if (a === "failed" || b === "failed" || a.length === 0 || b.length === 0) {
      const resolveError = a === "failed" || b === "failed" ? "failed" : "empty";
      setState({ ...IDLE, status: "done", resolveError });
      return;
    }

    const recording: GraphExpansionFetcher = {
      getTransaction: async (txid) => {
        const tx = await fetcher.getTransaction(txid, signal);
        seen.set(txid, tx);
        return tx;
      },
      getTxOutspends: (txid) => fetcher.getTxOutspends(txid, signal),
    };
    const summary = await findConnections(a, b, recording, options, {
      onResult: (path) => {
        if (signal.aborted) return;
        setTxs(new Map(seen));
        setState((s) => ({ ...s, results: [...s.results, path] }));
      },
      onProgress: (progress) => {
        if (!signal.aborted) setState((s) => ({ ...s, progress }));
      },
      isCoinJoin: isCoinJoinTx,
    }, signal);
    // A newer search replaced this one; a cancel still reports its summary
    if (abortRef.current !== ac) return;
    setTxs(new Map(seen));
    setState((s) => ({ ...s, status: "done", summary }));
  }, [fetcher]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(IDLE);
  }, []);

  return { ...state, txs, start, cancel, reset };
}
