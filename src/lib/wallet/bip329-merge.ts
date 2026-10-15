/**
 * Merge incoming BIP329 records into existing ones without overwriting
 * silently: a clash on the same type and ref with a different label is a
 * conflict, kept as existing unless the caller names it in `replaceKeys`.
 */
import { recordKey, userPart, type Bip329Record } from "./bip329";

export interface Bip329Conflict { key: string; existing: Bip329Record; incoming: Bip329Record }
export interface Bip329Merge { added: Bip329Record[]; unchanged: number; conflicts: Bip329Conflict[] }

/** Label as compared: automatic "aie:" parts dropped, whitespace trimmed. */
const norm = (r: Bip329Record) => userPart(r.label ?? "");

export function mergeBip329(existing: Bip329Record[], incoming: Bip329Record[]): Bip329Merge {
  const byKey = new Map(existing.map((r) => [recordKey(r), r]));
  const added: Bip329Record[] = [];
  const conflicts: Bip329Conflict[] = [];
  let unchanged = 0;
  for (const inc of incoming) {
    const key = recordKey(inc);
    const old = byKey.get(key);
    if (!old) added.push(inc);
    // An incoming record that says nothing about spendable (a freeze) leaves it as it is
    else if (norm(old) === norm(inc) && (inc.spendable === undefined || old.spendable === inc.spendable)) unchanged++;
    else conflicts.push({ key, existing: old, incoming: inc });
  }
  return { added, unchanged, conflicts };
}

/** Existing records (conflicts in `replaceKeys` swapped for the incoming one) followed by the added ones. */
export function applyMerge(existing: Bip329Record[], merge: Bip329Merge, replaceKeys: ReadonlySet<string>): Bip329Record[] {
  const swap = new Map(merge.conflicts.filter((c) => replaceKeys.has(c.key)).map((c) => [c.key, c.incoming]));
  return [...existing.map((r) => swap.get(recordKey(r)) ?? r), ...merge.added];
}
