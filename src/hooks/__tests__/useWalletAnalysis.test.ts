// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { NETWORK_CONFIG } from "@/lib/bitcoin/networks";

import { HDKey } from "@scure/bip32";
import type { BitcoinNetwork } from "@/lib/bitcoin/networks";

const net = vi.hoisted(() => ({ isUmbrel: false, setNetwork: vi.fn(), detected: null as string | null }));
vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => ({
    network: "mainnet", setNetwork: net.setNetwork, config: NETWORK_CONFIG.mainnet,
    configFor: (n: BitcoinNetwork) => NETWORK_CONFIG[n], customApiUrl: null, isUmbrel: net.isUmbrel, isCustomApi: false,
  }),
}));
// No address has history: a bare key falls back to native segwit
const createApiClient = vi.hoisted(() => vi.fn(() => ({
  getAddress: async () => ({ chain_stats: { tx_count: 0 }, mempool_stats: { tx_count: 0 } }),
})));
const local = vi.hoisted(() => ({ api: false }));
vi.mock("@/lib/api/client", () => ({ createApiClient, isLocalApi: () => local.api }));
vi.mock("@/lib/api/detect-network", () => ({ detectAddressNetwork: vi.fn(async () => net.detected) }));
// Echo the key so the test sees which translation was requested
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { useWalletAnalysis } from "../useWalletAnalysis";

afterEach(cleanup);

// Bitcoin Core doc/descriptors.md example; valid checksum is #ml40v0wf
const CORE_PKH =
  "pkh([d34db33f/44'/0'/0']xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/1/*)";

describe("useWalletAnalysis descriptor errors", () => {
  it.each([
    [`${CORE_PKH}#ml40v0wq`, "errors.descriptorChecksumMismatch"],
    [`${CORE_PKH}#ml40v0w`, "errors.descriptorChecksumFormat"],
  ])("translates the checksum error for %s", async (input, key) => {
    const { result } = renderHook(() => useWalletAnalysis());
    await act(async () => { await result.current.analyze(input); });
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe(key);
  });
});

// Testnet account key (tpub version bytes)
const TPUB = HDKey.fromMasterSeed(new Uint8Array(32).fill(1), { private: 0x04358394, public: 0x043587cf }).publicExtendedKey;

describe("useWalletAnalysis key on another network", () => {
  afterEach(() => { net.isUmbrel = false; net.detected = null; net.setNetwork.mockClear(); createApiClient.mockClear(); });

  it("self-hosted mainnet backend: clear error, nothing fetched", async () => {
    net.isUmbrel = true;
    const { result } = renderHook(() => useWalletAnalysis());
    await act(async () => { await result.current.analyze(TPUB); });
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("errors.walletWrongNetwork");
    expect(createApiClient).not.toHaveBeenCalled();
  });

  it("public mempool.space: switches to the key's network and scans there", async () => {
    net.detected = "signet";
    const { result } = renderHook(() => useWalletAnalysis());
    await act(async () => { await result.current.analyze(TPUB); });
    expect(net.setNetwork).toHaveBeenCalledWith("signet");
    expect(createApiClient).toHaveBeenCalledWith(NETWORK_CONFIG.signet, expect.anything());
    expect(result.current.autoSwitchedNetwork).toBe("signet");
    // A bare tpub is not assumed legacy
    expect(result.current.scriptTypeDetected).toBe(true);
    expect(result.current.descriptor?.scriptType).toBe("p2wpkh");
  });
});

describe("useWalletAnalysis gap limit", () => {
  afterEach(() => { local.api = false; net.detected = null; });
  // A mainnet xpub on the mainnet backend: no network switch
  const XPUB = HDKey.fromMasterSeed(new Uint8Array(32).fill(2)).publicExtendedKey;
  const run = async (gap?: number) => {
    const { result } = renderHook(() => useWalletAnalysis());
    await act(async () => { await result.current.analyze(XPUB, undefined, gap); });
    return result.current.gapLimit;
  };

  it("hosted API: the saved default (5)", async () => { expect(await run()).toBe(5); });
  it("self-hosted API: the wallet standard (20)", async () => { local.api = true; expect(await run()).toBe(20); });
  it("rescan override wins", async () => { expect(await run(20)).toBe(20); });
});
