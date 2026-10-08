"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient, isLocalApi } from "@/lib/api/client";
import { getAnalysisSettings } from "@/hooks/useAnalysisSettings";
import { DEFAULT_ANALYSIS_SETTINGS } from "@/lib/analysis/settings";
import {
  parseXpub,
  accountPathOf,
  deriveOneAddress,
  isDescriptor,
  type DescriptorParseResult,
  type ParsedXpub,
  type ScriptType,
} from "@/lib/bitcoin/descriptor";
import type { WalletAuditResult, WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import type { UtxoTraceResult } from "@/lib/wallet/scan";
import { mapApiErrorMessage } from "@/lib/api/error-message";
import { loadEngine } from "@/lib/analysis/load-engine";
import { detectAddressNetwork } from "@/lib/api/detect-network";
import { NETWORK_CONFIG, type BitcoinNetwork } from "@/lib/bitcoin/networks";
import type { Bip329Record } from "@/lib/wallet/bip329";
import {
  walletKey, loadSnapshot, saveSnapshot, forgetWallet, fullRescanReason, lastUsedIndex,
  SavedWalletError, SNAPSHOT_VERSION, type WalletSnapshot,
} from "@/lib/wallet/saved-wallets";

export type { UtxoTraceResult } from "@/lib/wallet/scan";

// ---------- Types ----------

type WalletPhase =
  | "idle"
  | "deriving"
  | "fetching"
  | "tracing"
  | "analyzing"
  | "complete"
  | "error";

interface WalletAnalysisState {
  phase: WalletPhase;
  /** Original xpub/descriptor input */
  query: string | null;
  /** Parsed descriptor result (addresses, script type, network) */
  descriptor: DescriptorParseResult | null;
  /** Wallet audit result */
  result: WalletAuditResult | null;
  /** Per-address info (for detail views) */
  addressInfos: WalletAddressInfo[];
  /** Addresses whose data could not be fetched (partial scan when non-empty) */
  failedAddresses: string[];
  /** Pre-fetched UTXO trace data for graph visualization */
  utxoTraces: Map<string, UtxoTraceResult> | null;
  /** Progress: addresses fetched so far / total (0 = unknown) */
  progress: { fetched: number; total: number };
  /** Tracing progress */
  traceProgress: { traced: number; total: number } | null;
  /** Error message */
  error: string | null;
  /** Duration in ms */
  durationMs: number | null;
  /** Set when the key belongs to another network and the scan switched to it */
  autoSwitchedNetwork: BitcoinNetwork | null;
  /** The address type of a bare xpub/tpub was guessed from on-chain history */
  scriptTypeDetected: boolean;
  /** Consecutive unused addresses the scan stopped after */
  gapLimit: number | null;
  /** BIP329 labels (saved with the wallet when it is saved) */
  labels: Bip329Record[];
  /** Set while the results come from (or were written to) a saved snapshot */
  saved: SavedStatus | null;
  /** Hashed id of this wallet's saved scan (set whether or not one exists) */
  snapshotKey: string | null;
  /** The scan could not be saved on this device */
  saveError: { code: SavedWalletError["code"]; size: number } | null;
}

export interface SavedStatus {
  /** When the shown data was last fetched (ms) */
  scannedAt: number;
  /** saved: fresh full scan stored; refreshing: saved scan shown, quick refresh running */
  status: "saved" | "refreshing" | "upToDate" | "updated" | "failed";
  newTxs: number;
}

/** Wallet software's usual gap limit; used on self-hosted backends, which have no throttle. */
export const STANDARD_GAP_LIMIT = 20;
/** Gap limits offered for a rescan (only those above the limit used are shown). */
export const RESCAN_GAP_LIMITS = [20, 100, 300, 1000] as const;

const INITIAL_STATE: WalletAnalysisState = {
  phase: "idle",
  query: null,
  descriptor: null,
  result: null,
  addressInfos: [],
  failedAddresses: [],
  utxoTraces: null,
  progress: { fetched: 0, total: 0 },
  traceProgress: null,
  error: null,
  durationMs: null,
  autoSwitchedNetwork: null,
  scriptTypeDetected: false,
  gapLimit: null,
  labels: [],
  saved: null,
  snapshotKey: null,
  saveError: null,
};

/** Chain tip height, uncached and best-effort. */
async function fetchTipHeight(baseUrl: string, signal: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/blocks/tip/height`, { signal, headers: { Accept: "text/plain" } });
    const n = res.ok ? parseInt((await res.text()).trim(), 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function descriptorOf(parsed: ParsedXpub, infos: WalletAddressInfo[]): DescriptorParseResult {
  return {
    scriptType: parsed.scriptType,
    network: parsed.network,
    receiveAddresses: infos.filter(i => !i.derived.isChange).map(i => i.derived),
    changeAddresses: infos.filter(i => i.derived.isChange).map(i => i.derived),
    xpub: parsed.xpub,
    accountPath: accountPathOf(parsed),
  };
}

const toSaveError = (e: unknown) => e instanceof SavedWalletError ? { code: e.code, size: e.size } : null;

// ---------- Hook ----------

export function useWalletAnalysis() {
  const [state, setState] = useState<WalletAnalysisState>(INITIAL_STATE);
  const { t } = useTranslation();
  const { network, setNetwork, config, configFor, customApiUrl, isUmbrel, isCustomApi } = useNetwork();
  const abortRef = useRef<AbortController | null>(null);
  /** The saved snapshot behind the shown results (labels are written through it) */
  const savedRef = useRef<{ key: string; xpub: string; backend: string; snap: WalletSnapshot } | null>(null);

  const analyze = useCallback(
    async (input: string, scriptTypeOverride?: ScriptType, gapLimitOverride?: number, { fullRescan = false } = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const startTime = Date.now();
      savedRef.current = null;

      setState({
        ...INITIAL_STATE,
        phase: "deriving",
        query: input,
      });

      try {
        // Step 1: Parse xpub/descriptor (no address derivation yet)
        let parsed = parseXpub(input, scriptTypeOverride);

        // A key for another network (tpub on mainnet, xpub on signet): on public
        // mempool.space scan where its addresses live, like a single address does.
        // A self-hosted or custom backend cannot answer for another network.
        let cfg = config;
        let switchedTo: BitcoinNetwork | null = null;
        if ((parsed.network === "mainnet") !== (network === "mainnet")) {
          const first = deriveOneAddress(parsed, parsed.singleChain === 1 ? 1 : 0, 0).address;
          const detected = isUmbrel || customApiUrl
            ? null
            : await detectAddressNetwork(first, network, controller.signal, (n) => configFor(n).mempoolBaseUrl);
          if (controller.signal.aborted) return;
          if (!detected) {
            throw new Error(t("errors.walletWrongNetwork", {
              keyNetwork: parsed.network === "mainnet" ? "Mainnet" : "Testnet/Signet",
              network: NETWORK_CONFIG[network].label,
              defaultValue: "This key belongs to {{keyNetwork}}, but the connected backend serves {{network}}. Its addresses cannot be looked up there.",
            }));
          }
          cfg = configFor(detected);
          switchedTo = detected;
          setNetwork(detected);
        }

        const engine = await loadEngine();
        if (controller.signal.aborted) return;
        const api = createApiClient(cfg, controller.signal);

        // A bare xpub/tpub (the "legacy" prefix) can be any address type
        const bareKey = !scriptTypeOverride && !isDescriptor(input) && parsed.scriptType === "p2pkh";

        // A saved scan of this wallet on this backend (a bare key: under the type it was saved as)
        const backend = cfg.mempoolBaseUrl;
        let snap: WalletSnapshot | null = null;
        let key = "";
        for (const scriptType of bareKey ? engine.BARE_KEY_TYPES : [parsed.scriptType]) {
          const k = walletKey({ ...parsed, scriptType }, backend);
          const found = await loadSnapshot(k, parsed.xpub);
          if (found) { snap = found; key = k; parsed = { ...parsed, scriptType }; break; }
        }
        if (controller.signal.aborted) return;

        if (bareKey && !snap) {
          parsed = { ...parsed, scriptType: await engine.detectScriptType(parsed, api) };
          if (controller.signal.aborted) return;
        }

        key ||= walletKey(parsed, backend);

        setState(prev => ({
          ...prev,
          phase: "fetching",
          descriptor: {
            scriptType: parsed.scriptType,
            network: parsed.network,
            receiveAddresses: [],
            changeAddresses: [],
            xpub: parsed.xpub,
            accountPath: accountPathOf(parsed),
          },
          progress: { fetched: 0, total: 0 },
          snapshotKey: key,
          autoSwitchedNetwork: switchedTo,
          scriptTypeDetected: bareKey,
        }));

        const {
          scanChain, walletChains, collectWalletTxs, traceWalletTxs, UTXO_TRACE_DEPTH, auditWallet, buildTraceBarrier, quickRefresh,
        } = engine;

        // Step 2: Incrementally derive + fetch addresses.
        const localApi = isLocalApi(cfg.mempoolBaseUrl);
        const { walletGapLimit: savedGap, minSats } = getAnalysisSettings();
        // The low default keeps hosted scans short (throttled); a self-hosted backend scans like a wallet
        const settingGap = localApi && savedGap === DEFAULT_ANALYSIS_SETTINGS.walletGapLimit ? STANDARD_GAP_LIMIT : savedGap;
        const traceOpts = () => {
          const settings = getAnalysisSettings();
          return {
            depth: Math.min(UTXO_TRACE_DEPTH, settings.maxDepth),
            minSats,
            // Hosted APIs: one trace at a time to stay under the rate limit
            concurrency: localApi ? 3 : 1,
            barrier: buildTraceBarrier(settings),
          };
        };

        // Saved scan, recent enough and walked at least as deep as asked: show it, then quick-refresh
        if (snap && !fullRescan && gapLimitOverride === undefined && fullRescanReason(snap, settingGap) === null) {
          const base = snap;
          const savedTraces = new Map(base.traces);
          savedRef.current = { key, xpub: parsed.xpub, backend, snap: base };
          setState(prev => ({
            ...prev,
            phase: "complete",
            descriptor: descriptorOf(parsed, base.infos),
            result: auditWallet(base.infos),
            addressInfos: base.infos,
            utxoTraces: savedTraces.size > 0 ? savedTraces : null,
            gapLimit: base.gapLimit,
            labels: base.labels,
            saved: { scannedAt: base.scannedAt, status: "refreshing", newTxs: 0 },
          }));
          try {
            const fresh = createApiClient(cfg, controller.signal, { fresh: true });
            const r = await quickRefresh(base, parsed, walletChains(parsed), fresh,
              () => fetchTipHeight(backend, controller.signal), { signal: controller.signal, local: localApi });
            if (controller.signal.aborted) return;
            // Graph pre-expansion: saved traces are kept, only new wallet txs are traced
            const wanted = collectWalletTxs(r.infos);
            const toTrace = new Map([...wanted].filter(([txid]) => !savedTraces.has(txid)));
            const traced = toTrace.size > 0
              ? await traceWalletTxs(toTrace, api, controller.signal, traceOpts(), () => {})
              : new Map<string, UtxoTraceResult>();
            if (controller.signal.aborted) return;
            const traces = new Map([...wanted.keys()].flatMap(txid => {
              const tr = traced.get(txid) ?? savedTraces.get(txid);
              return tr ? [[txid, tr] as const] : [];
            }));
            const ctx = savedRef.current;
            const next: WalletSnapshot = {
              ...base, scannedAt: Date.now(), tipHeight: r.tipHeight, lastUsed: lastUsedIndex(r.infos),
              infos: r.infos, traces: [...traces], labels: ctx?.snap.labels ?? base.labels,
            };
            setState(prev => ({
              ...prev,
              descriptor: descriptorOf(parsed, r.infos),
              result: auditWallet(r.infos),
              addressInfos: r.infos,
              utxoTraces: traces.size > 0 ? traces : null,
              durationMs: Date.now() - startTime,
              // A forgotten wallet stays forgotten
              saved: ctx ? { scannedAt: next.scannedAt, status: r.newTxids.length > 0 ? "updated" : "upToDate", newTxs: r.newTxids.length } : null,
            }));
            if (ctx?.key === key) {
              ctx.snap = next;
              const saveError = await saveSnapshot(key, parsed.xpub, backend, next).then(() => null, toSaveError);
              if (saveError) setState(prev => ({ ...prev, saveError }));
            }
          } catch {
            if (controller.signal.aborted) return;
            setState(prev => ({ ...prev, saved: prev.saved && { ...prev.saved, status: "failed" } }));
          }
          return;
        }

        // A full rescan never walks less deep than the saved scan did
        const walletGapLimit = gapLimitOverride
          ?? Math.max(settingGap, snap?.v === SNAPSHOT_VERSION ? snap.gapLimit : 0);
        setState(prev => ({ ...prev, gapLimit: walletGapLimit }));
        const allInfos: WalletAddressInfo[] = [];
        const failedAddresses: string[] = [];
        let fetched = 0;

        const onProgress = (info: WalletAddressInfo) => {
          allInfos.push(info);
          fetched++;
          setState(prev => ({
            ...prev,
            progress: { fetched, total: 0 },
          }));
        };

        // Scan receive chain (0) then change chain (1)
        for (const chain of walletChains(parsed)) {
          if (controller.signal.aborted) return;
          const { failed } = await scanChain(parsed, chain, api, controller.signal, localApi, walletGapLimit, onProgress);
          failedAddresses.push(...failed);
        }

        if (controller.signal.aborted) return;

        const descriptor = descriptorOf(parsed, allInfos);

        // Step 2.5: Trace wallet tx provenance concurrently
        const utxoTxs = collectWalletTxs(allInfos);
        let utxoTraces: Map<string, UtxoTraceResult> | null = null;

        if (utxoTxs.size > 0) {
          setState(prev => ({
            ...prev,
            phase: "tracing",
            descriptor,
            progress: { fetched, total: fetched },
            traceProgress: { traced: 0, total: utxoTxs.size },
          }));

          const traceResults = await traceWalletTxs(
            utxoTxs,
            api,
            controller.signal,
            traceOpts(),
            (traced) => setState(prev => ({
              ...prev,
              traceProgress: { traced, total: utxoTxs.size },
            })),
          );
          if (controller.signal.aborted) return;

          utxoTraces = traceResults.size > 0 ? traceResults : null;
        }

        // Step 3: Run wallet audit
        setState(prev => ({
          ...prev,
          phase: "analyzing",
          descriptor,
          progress: { fetched, total: fetched },
        }));

        const result = auditWallet(allInfos, failedAddresses);
        const labels = snap?.labels ?? [];

        // Save a complete scan (a partial one would hide the failed addresses from every quick refresh)
        let saved: SavedStatus | null = null;
        let saveError: WalletAnalysisState["saveError"] = null;
        if (failedAddresses.length === 0 && getAnalysisSettings().enableCache) {
          const now = Date.now();
          const next: WalletSnapshot = {
            v: SNAPSHOT_VERSION, scannedAt: now, fullScanAt: now, gapLimit: walletGapLimit,
            tipHeight: await fetchTipHeight(backend, controller.signal), scriptType: parsed.scriptType,
            lastUsed: lastUsedIndex(allInfos), infos: allInfos, traces: utxoTraces ? [...utxoTraces] : [], labels,
          };
          if (controller.signal.aborted) return;
          saveError = await saveSnapshot(key, parsed.xpub, backend, next).then(() => null, toSaveError);
          if (!saveError) {
            savedRef.current = { key, xpub: parsed.xpub, backend, snap: next };
            saved = { scannedAt: now, status: "saved", newTxs: 0 };
          }
        }

        setState(prev => ({
          ...prev,
          phase: "complete",
          result,
          addressInfos: allInfos,
          failedAddresses,
          utxoTraces,
          labels,
          saved,
          saveError,
          durationMs: Date.now() - startTime,
        }));
      } catch (err) {
        if (controller.signal.aborted) return;

        // Parse errors (invalid xpub/descriptor) carry a useful message;
        // descriptor.ts throws English, so translate the checksum ones here
        const raw = err instanceof Error ? err.message : undefined;
        const fallback = raw?.startsWith("Invalid descriptor checksum format")
          ? t("errors.descriptorChecksumFormat", { defaultValue: "Invalid descriptor checksum format: expected 8 characters after '#'." })
          : raw?.startsWith("Descriptor checksum mismatch")
            ? t("errors.descriptorChecksumMismatch", { defaultValue: "Descriptor checksum mismatch: the descriptor may be mistyped or truncated." })
            : raw;
        const { message } = mapApiErrorMessage(err, t, { isUmbrel, isCustomApi, fallback });

        setState(prev => ({
          ...prev,
          phase: "error",
          error: message,
        }));
      }
    },
    [network, setNetwork, config, configFor, customApiUrl, t, isUmbrel, isCustomApi],
  );

  // Abort in-flight requests on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    savedRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  /** Update labels; a saved wallet keeps them with its snapshot. */
  const setLabels = useCallback((labels: Bip329Record[]) => {
    setState(prev => ({ ...prev, labels }));
    const ctx = savedRef.current;
    if (!ctx) return;
    ctx.snap = { ...ctx.snap, labels };
    saveSnapshot(ctx.key, ctx.xpub, ctx.backend, ctx.snap).catch((e: unknown) => {
      const saveError = toSaveError(e);
      if (saveError) setState(prev => ({ ...prev, saveError }));
    });
  }, []);

  /** "Forget this wallet": delete its snapshot; the shown results stay until the next scan. */
  const forget = useCallback(async () => {
    const ctx = savedRef.current;
    savedRef.current = null;
    setState(prev => ({ ...prev, saved: null }));
    if (ctx) await forgetWallet(ctx.key);
  }, []);

  return { ...state, analyze, reset, setLabels, forget };
}
