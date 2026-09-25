// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { NETWORK_CONFIG } from "@/lib/bitcoin/networks";

vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => ({ config: NETWORK_CONFIG.mainnet, isUmbrel: false, isCustomApi: false }),
}));
vi.mock("@/lib/api/client", () => ({ createApiClient: () => ({}), isLocalApi: () => false }));
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
