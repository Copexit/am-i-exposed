import { describe, it, expect } from "vitest";
import { RECOMMENDED_WALLETS } from "../wallets";

/**
 * Source-code-cited facts for the wallet comparison table. These pin
 * down the antiFeeSniping defaults that have been audited against the
 * upstream wallet code, so a future data sweep cannot silently flip
 * them back without the test failing.
 *
 * Citations live in the PR descriptions for adb691d (Trezor / Cake /
 * BlueWallet / BitBox) and #88 (Nunchuk). Bull Bitcoin's `true` is
 * source-verified against BDK's TxBuilder default.
 */
const ANTI_FEE_SNIPING_GROUND_TRUTH: Record<string, boolean> = {
  // Verified true: wallet sets nLockTime to current block height by default.
  Sparrow: true,
  "Bitcoin Core": true,
  Electrum: true,
  Ashigaru: true,
  "Blockstream App": true,
  "Bull Bitcoin": true, // uses BDK TxBuilder (sets locktime by default)

  // Verified false: wallet leaves nLockTime at 0 by default, even if a
  // user-toggleable setting exists (Nunchuk) or if the protocol uses
  // a different timelock strategy (Wasabi).
  "Trezor Suite": false,
  Wasabi: false,
  "Cake Wallet": false,
  Nunchuk: false, // PR #88 - opt-in only via Fee Settings, defaults to off
  "Blue Wallet": false,
  BitBoxApp: false,
};

function findWallet(name: string) {
  const w = RECOMMENDED_WALLETS.find((x) => x.name === name);
  if (!w) throw new Error(`wallet ${name} not present in RECOMMENDED_WALLETS`);
  return w;
}

describe("RECOMMENDED_WALLETS antiFeeSniping ground truth", () => {
  for (const [name, expected] of Object.entries(ANTI_FEE_SNIPING_GROUND_TRUTH)) {
    it(`${name} antiFeeSniping === ${expected}`, () => {
      expect(findWallet(name).antiFeeSniping).toBe(expected);
    });
  }

  it("every wallet in the audit list is present in the table", () => {
    const tableNames = new Set(RECOMMENDED_WALLETS.map((w) => w.name));
    for (const name of Object.keys(ANTI_FEE_SNIPING_GROUND_TRUTH)) {
      expect(tableNames.has(name), `expected ${name} in RECOMMENDED_WALLETS`).toBe(true);
    }
  });
});

describe("RECOMMENDED_WALLETS schema", () => {
  it("has no duplicate wallet names", () => {
    const names = RECOMMENDED_WALLETS.map((w) => w.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("every wallet declares at least one device type", () => {
    for (const w of RECOMMENDED_WALLETS) {
      expect(w.type.length, `${w.name} has no type`).toBeGreaterThan(0);
    }
  });
});
