import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import type { NostrEvent, NostrSnapshot } from "./types";

/** NIP-01 id: sha256 hex of [0, pubkey, created_at, kind, tags, content]. */
export function eventId(e: Omit<NostrEvent, "id" | "sig">): string {
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]))));
}

/** id matches AND the BIP-340 signature verifies; false on any throw. */
export function verifyEvent(e: NostrEvent): boolean {
  try {
    const id = eventId(e);
    return id === e.id && schnorr.verify(hexToBytes(e.sig), hexToBytes(id), hexToBytes(e.pubkey));
  } catch {
    return false;
  }
}

export function verifySnapshot(s: NostrSnapshot): { events: NostrEvent[]; rejected: number } {
  const events = s.events.filter(verifyEvent);
  return { events, rejected: s.events.length - events.length };
}

/** Values after the tag name, first match. */
export function tag(e: NostrEvent, name: string): string[] | undefined {
  const t = e.tags.find((x) => x[0] === name);
  return t ? t.slice(1) : undefined;
}

/** Newest per `${pubkey}:${kind}:${d}`; ties by id. */
export function latestReplaceable(events: NostrEvent[]): NostrEvent[] {
  const best = new Map<string, NostrEvent>();
  for (const e of events) {
    const key = `${e.pubkey}:${e.kind}:${tag(e, "d")?.[0] ?? ""}`;
    const cur = best.get(key);
    if (!cur || e.created_at > cur.created_at || (e.created_at === cur.created_at && e.id > cur.id)) best.set(key, e);
  }
  return [...best.values()];
}
