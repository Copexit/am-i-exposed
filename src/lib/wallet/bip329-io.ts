import { MAX_FILE_BYTES, parseBip329, serializeBip329, type Bip329ParseResult, type Bip329Record } from "./bip329";

/** Read a BIP329 file: null when it is larger than MAX_FILE_BYTES. */
export async function readBip329File(file: File): Promise<Bip329ParseResult | null> {
  if (file.size > MAX_FILE_BYTES) return null;
  return parseBip329(await file.text());
}

/** Download records as a BIP329 .jsonl file. */
export function downloadBip329(records: readonly Bip329Record[], filename: string) {
  const blob = new Blob([serializeBip329(records)], { type: "application/jsonl" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Firefox starts the download after click() returns: revoke later
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
