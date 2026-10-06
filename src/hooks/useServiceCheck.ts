"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNetwork } from "@/context/NetworkContext";
import { grantLookupConsent } from "@/lib/services/consent";
import { lookupTx, summarize, type AttributionSummary, type TxAttribution } from "@/lib/services/wabisabi-attribution";

const CONCURRENCY = 2;
const GAP_MS = 250;

type Phase = "idle" | "running" | "done";
interface State { key: string; phase: Phase; done: number; total: number; results: TxAttribution[] }

export interface ServiceCheck {
  phase: Phase;
  done: number;
  total: number;
  results: TxAttribution[];
  summary: AttributionSummary | null;
  start(): void;
  retryFailed(): void;
}

const NO_RESULTS: TxAttribution[] = [];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Wabisator CoinJoin attribution for a set of txids, run only on start().
 * A changed txid set or unmount aborts in-flight lookups and drops their results.
 */
export function useServiceCheck(txids: string[], isLocalCoinJoin: (txid: string) => boolean): ServiceCheck {
  const { isUmbrel } = useNetwork();
  const key = txids.join(",");
  const [state, setState] = useState<State>({ key, phase: "idle", done: 0, total: 0, results: [] });
  const ctrlRef = useRef<AbortController | null>(null);

  // A new txid set (or unmount) aborts and forgets the run, so returning to an
  // earlier set shows the consent state again.
  useEffect(
    () => () => {
      ctrlRef.current?.abort();
      setState({ key: "", phase: "idle", done: 0, total: 0, results: [] });
    },
    [key],
  );

  const run = useCallback(
    async (ids: string[], base: TxAttribution[]) => {
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      const { signal } = ctrl;
      const consent = grantLookupConsent("wabisator", ids);
      setState({ key, phase: "running", done: 0, total: ids.length, results: base });

      let next = 0;
      // Each start waits for the previous start + GAP_MS.
      let gate = Promise.resolve();
      const worker = async () => {
        while (next < ids.length && !signal.aborted) {
          const txid = ids[next++]!;
          const slot = gate;
          gate = gate.then(() => sleep(GAP_MS));
          await slot;
          if (signal.aborted) return;
          let r: TxAttribution;
          try {
            r = await lookupTx(txid, { isUmbrel, signal, consent });
          } catch (err) {
            if (signal.aborted) return;
            r = { kind: "error", txid, message: err instanceof Error ? err.message : "Lookup failed" };
          }
          if (signal.aborted) return;
          setState((s) => ({ ...s, done: s.done + 1, results: [...s.results.filter((x) => x.txid !== r.txid), r] }));
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
      if (!signal.aborted) setState((s) => ({ ...s, phase: "done" }));
    },
    [key, isUmbrel],
  );

  const current = state.key === key ? state : null;
  const results = current?.results ?? NO_RESULTS;

  const start = useCallback(() => void run(txids, []), [run, txids]);
  const retryFailed = useCallback(
    () => void run(results.filter((r) => r.kind === "error").map((r) => r.txid), results),
    [run, results],
  );

  return {
    phase: current?.phase ?? "idle",
    done: current?.done ?? 0,
    total: current?.total ?? 0,
    results,
    summary: current?.phase === "done" ? summarize(results, isLocalCoinJoin) : null,
    start,
    retryFailed,
  };
}
