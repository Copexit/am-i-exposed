/**
 * Wallet key lock: the raw xpubs/descriptors of wallet bookmarks sealed with a
 * password in one localStorage entry, each bookmark keeping only a placeholder.
 * Pure parts here; the bookmark-side operations live in src/hooks/walletVault.ts.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { newSealKey, openJsonKeyed, openJsonWithKey, sealJsonWithKey, isSealedEnvelope, type SealedEnvelope, type SealKey } from "@/lib/crypto/envelope";

export const VAULT_KEY = "ami-wallet-vault";
const PREFIX = "wallet-locked:";

/** Sealed contents: placeholder -> raw input. */
export type VaultEntries = Record<string, string>;

/**
 * Stable placeholder for a wallet's input. Hashed with its own domain tag, so
 * it never equals (or shares a prefix with) the saved-scan key `walletKey()`.
 */
export function placeholderFor(input: string): string {
  return PREFIX + bytesToHex(sha256(new TextEncoder().encode(`ami-wallet-lock|${input}`))).slice(0, 16);
}

export const isPlaceholder = (s: string): boolean => /^wallet-locked:[0-9a-f]{16}$/.test(s);

export function parseVault(raw: string): SealedEnvelope | null {
  const v: unknown = JSON.parse(raw);
  return isSealedEnvelope(v) ? v : null;
}

/** The lock is on while a (well-formed) vault is stored. */
export function isLockOn(): boolean {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    return raw !== null && parseVault(raw) !== null;
  } catch {
    return false;
  }
}

export const sealVault = (entries: VaultEntries, k: SealKey): Promise<SealedEnvelope> => sealJsonWithKey({ entries }, k);

/** Raised when the vault decrypts but its content is not a vault. */
export class DamagedVaultError extends Error {
  constructor() {
    super("Malformed wallet vault");
    this.name = "DamagedVaultError";
  }
}

function toEntries(value: { entries?: unknown } | null): VaultEntries {
  const e = value?.entries;
  if (typeof e !== "object" || e === null || Array.isArray(e)) throw new DamagedVaultError();
  return Object.fromEntries(Object.entries(e).filter((x): x is [string, string] => isPlaceholder(x[0]) && typeof x[1] === "string"));
}

/** A new vault key (fresh salt): only when the lock is turned on. */
export const newVaultKey = (password: string): Promise<SealKey> => newSealKey(password);

/** Throws WrongPasswordError on a wrong password, DamagedVaultError on a malformed vault. */
export async function openVault(env: SealedEnvelope, password: string): Promise<{ entries: VaultEntries; sealKey: SealKey }> {
  const { value, sealKey } = await openJsonKeyed<{ entries?: unknown } | null>(env, password);
  return { entries: toEntries(value), sealKey };
}

/** Open another vault sealed under the same key (same lock, e.g. an earlier backup of it); WrongPasswordError otherwise. */
export async function openVaultWithKey(env: SealedEnvelope, k: SealKey): Promise<VaultEntries> {
  return toEntries(await openJsonWithKey<{ entries?: unknown } | null>(env, k));
}
