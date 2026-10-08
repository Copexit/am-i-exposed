// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { NETWORK_CONFIG } from "@/lib/bitcoin/networks";
import { saveAnalysisSettings, DEFAULT_ANALYSIS_SETTINGS } from "@/lib/analysis/settings";
import { clearSavedWallets, loadSnapshot, saveSnapshot, walletKey, listSavedWallets } from "@/lib/wallet/saved-wallets";
import { FakeChain, ZPUB, parsed, addr } from "@/lib/wallet/__tests__/fake-chain";

const chain = vi.hoisted(() => ({ current: null as unknown as import("@/lib/wallet/__tests__/fake-chain").FakeChain }));
vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => ({
    network: "mainnet", setNetwork: vi.fn(), config: NETWORK_CONFIG.mainnet,
    configFor: (n: keyof typeof NETWORK_CONFIG) => NETWORK_CONFIG[n], customApiUrl: null, isUmbrel: false, isCustomApi: false,
  }),
}));
// Self-hosted: no throttle delays, gap limit 20
vi.mock("@/lib/api/client", () => ({ createApiClient: () => chain.current.client(), isLocalApi: () => true }));
const detect = vi.hoisted(() => vi.fn(async () => "signet"));
vi.mock("@/lib/api/detect-network", () => ({ detectAddressNetwork: detect }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { useWalletAnalysis } from "../useWalletAnalysis";

vi.setConfig({ testTimeout: 30_000 });
const BASE = NETWORK_CONFIG.mainnet.mempoolBaseUrl;
const KEY = walletKey(parsed, BASE);

beforeEach(async () => {
  await clearSavedWallets();
  chain.current = new FakeChain();
  chain.current.tx([{ address: addr(0, 0), value: 70_000 }]);
  chain.current.mine(10);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(String(chain.current.tip))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); saveAnalysisSettings(DEFAULT_ANALYSIS_SETTINGS); });

async function scan(opts?: { fullRescan?: boolean }) {
  const hook = renderHook(() => useWalletAnalysis());
  chain.current.requests = {};
  await act(async () => { await hook.result.current.analyze(ZPUB, undefined, undefined, opts); });
  return hook.result;
}

describe("useWalletAnalysis saved wallets", () => {
  it("saves a full scan, then reopens it at once and quick-refreshes", async () => {
    const first = await scan();
    expect(first.current.saved).toMatchObject({ status: "saved" });
    expect(first.current.result?.totalTxs).toBe(1);

    const second = await scan();
    expect(second.current.phase).toBe("complete");
    expect(second.current.saved).toMatchObject({ status: "upToDate", newTxs: 0 });
    // No address history refetched: outspends + frontier only
    expect(chain.current.requests.getAddressTxs).toBeUndefined();
    expect(second.current.result?.totalTxs).toBe(1);
  });

  it("shows the saved scan while refreshing, then reports new transactions", async () => {
    await scan();
    chain.current.tx([{ address: addr(0, 1), value: 5_000 }], [], false);
    // Hold the refresh at its first request (the tip height)
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.stubGlobal("fetch", vi.fn(async () => { await gate; return new Response(String(chain.current.tip)); }));
    const hook = renderHook(() => useWalletAnalysis());
    let done!: Promise<void>;
    act(() => { done = hook.result.current.analyze(ZPUB); });
    await waitFor(() => expect(hook.result.current.saved?.status).toBe("refreshing"));
    expect(hook.result.current.phase).toBe("complete");
    expect(hook.result.current.result?.totalTxs).toBe(1);
    release();
    await act(async () => { await done; });
    expect(hook.result.current.saved).toMatchObject({ status: "updated", newTxs: 1 });
    expect(hook.result.current.result?.totalTxs).toBe(2);
    expect((await loadSnapshot(KEY, ZPUB))!.infos.flatMap(i => i.txs)).toHaveLength(2);
  });

  it("runs a full rescan automatically when the snapshot is older than 7 days", async () => {
    await scan();
    const snap = (await loadSnapshot(KEY, ZPUB))!;
    await saveSnapshot(KEY, ZPUB, BASE, { ...snap, fullScanAt: Date.now() - 8 * 86_400_000 });
    const r = await scan();
    expect(r.current.saved).toMatchObject({ status: "saved" });
    expect(chain.current.requests.getAddressTxs).toBeGreaterThan(20);
    expect((await loadSnapshot(KEY, ZPUB))!.fullScanAt).toBeGreaterThan(Date.now() - 60_000);
  });

  it("the Full rescan action walks the gap limit even with a fresh snapshot", async () => {
    await scan();
    const r = await scan({ fullRescan: true });
    expect(r.current.saved).toMatchObject({ status: "saved" });
    expect(chain.current.requests.getAddressTxs).toBeGreaterThan(20);
  });

  it("keeps labels with the saved wallet", async () => {
    const first = await scan();
    act(() => { first.current.setLabels([{ type: "addr", ref: addr(0, 0), label: "salary" }]); });
    await waitFor(async () => expect((await loadSnapshot(KEY, ZPUB))?.labels).toHaveLength(1));
    const second = await scan();
    expect(second.current.labels).toEqual([{ type: "addr", ref: addr(0, 0), label: "salary" }]);
  });

  it("forget deletes the snapshot", async () => {
    const r = await scan();
    await act(async () => { await r.current.forget(); });
    expect(r.current.saved).toBeNull();
    expect(await loadSnapshot(KEY, ZPUB)).toBeNull();
  });

  it("saves nothing with the cache setting off", async () => {
    saveAnalysisSettings({ ...DEFAULT_ANALYSIS_SETTINGS, enableCache: false });
    const r = await scan();
    expect(r.current.phase).toBe("complete");
    expect(r.current.saved).toBeNull();
    saveAnalysisSettings(DEFAULT_ANALYSIS_SETTINGS);
    expect(await listSavedWallets()).toEqual([]);
  });

  it("a saved key from another network reopens without network detection requests", async () => {
    // Testnet key, empty history, on the mainnet backend: detected as signet once
    const { HDKey } = await import("@scure/bip32");
    const tpub = HDKey.fromMasterSeed(new Uint8Array(32).fill(7), { private: 0x04358394, public: 0x043587cf }).publicExtendedKey;
    detect.mockClear();
    const run = async () => {
      const hook = renderHook(() => useWalletAnalysis());
      await act(async () => { await hook.result.current.analyze(`wpkh(${tpub})`); });
      return hook.result;
    };
    expect((await run()).current.saved).toMatchObject({ status: "saved" });
    expect(detect).toHaveBeenCalledTimes(1);
    const second = await run();
    expect(second.current.autoSwitchedNetwork).toBe("signet");
    expect(second.current.saved?.status).toBe("upToDate");
    expect(detect).toHaveBeenCalledTimes(1);
  });
});
