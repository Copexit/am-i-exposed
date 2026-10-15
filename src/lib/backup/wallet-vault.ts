/**
 * Wallet key lock: the raw xpubs/descriptors of wallet bookmarks sealed with a
 * password in one localStorage entry, each bookmark keeping only a placeholder.
 * Pure parts here; the bookmark-side operations live in src/hooks/walletVault.ts.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { openJson, sealJson, isSealedEnvelope, type SealedEnvelope } from "@/lib/crypto/envelope";

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

/** The lock is on while a vault is stored. */
export function isLockOn(): boolean {
  try {
    return localStorage.getItem(VAULT_KEY) !== null;
  } catch {
    return false;
  }
}

export const sealVault = (entries: VaultEntries, password: string): Promise<SealedEnvelope> => sealJson({ entries }, password);

/** Throws WrongPasswordError on a wrong password, Error on a malformed vault. */
export async function openVault(env: SealedEnvelope, password: string): Promise<VaultEntries> {
  const v = await openJson<{ entries?: unknown }>(env, password);
  const e = v?.entries;
  if (typeof e !== "object" || e === null || Array.isArray(e)) throw new Error("Malformed wallet vault");
  return Object.fromEntries(Object.entries(e).filter((x): x is [string, string] => isPlaceholder(x[0]) && typeof x[1] === "string"));
}

export function parseVault(raw: string): SealedEnvelope | null {
  const v: unknown = JSON.parse(raw);
  return isSealedEnvelope(v) ? v : null;
}
