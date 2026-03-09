/**
 * Maps wallet display names to icon file stems in /wallets/*.webp.
 * Supports compound fingerprint names like "Ashigaru/Sparrow (Whirlpool)"
 * by checking substrings.
 */

const WALLET_ICON_MAP: [substring: string, iconId: string][] = [
  ["sparrow", "sparrow"],
  ["bitcoin core", "bitcoin-core"],
  ["electrum", "electrum"],
  ["ashigaru", "ashigaru"],
  ["wasabi", "wasabi"],
  ["trezor", "trezor"],
  ["exodus", "exodus"],
  ["ledger", "ledger"],
  ["bluewallet", "bluewallet"],
  ["blue wallet", "bluewallet"],
  ["blockstream", "green"],
  ["jade", "green"],
  ["green", "green"],
  ["muun", "muun"],
  ["bitkit", "bitkit"],
];

/** Resolve a wallet display name to an icon file stem, or null if no match. */
export function getWalletIconId(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [substring, iconId] of WALLET_ICON_MAP) {
    if (lower.includes(substring)) return iconId;
  }
  return null;
}
