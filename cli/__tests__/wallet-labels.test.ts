/**
 * scan xpub --labels / --export-labels (walletLabelFiles).
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { History, recv, chg, ext } from "@/lib/analysis/__tests__/fixtures/wallet-history";
import { parseBip329 } from "@/lib/wallet/bip329";
import { walletLabelFiles } from "../src/commands/scan-xpub";

function wallet() {
  const h = new History();
  const a = h.receive(recv(0), 500_000, 100);
  const [, c] = h.tx([a], [{ address: ext(1), value: 200_000 }, { address: chg(0), value: 299_000 }], 102);
  return { a, c: c!, infos: h.infos([{ address: recv(0), isChange: false, index: 0 }, { address: chg(0), isChange: true, index: 0 }]) };
}

describe("walletLabelFiles", () => {
  it("does nothing without the options", () => {
    expect(walletLabelFiles(wallet().infos, "xpub", {})).toBeNull();
  });

  it("imports, summarizes and exports a file that imports back to the same labels", () => {
    const { a, c, infos } = wallet();
    const dir = mkdtempSync(join(tmpdir(), "aie-labels-"));
    const input = join(dir, "in.jsonl");
    const output = join(dir, "out.jsonl");
    writeFileSync(input, [
      `{"type":"tx","ref":"${a.txid}","label":"[KYC] Bitstamp"}`,
      `{"type":"output","ref":"${c.txid}:1","label":"[cambio] rent","spendable":false}`,
      `{"type":"tx","ref":"${"e".repeat(64)}","label":"other wallet"}`,
      "not json",
    ].join("\n"));
    const s = walletLabelFiles(infos, "xpub", { labels: input, exportLabels: output })!;
    expect(s).toMatchObject({ applied: 2, onCoins: 1, history: 1, unmatched: 1, invalid: 1, frozen: 1 });
    const back = parseBip329(readFileSync(output, "utf8"))!.records;
    expect(back).toEqual(parseBip329(readFileSync(input, "utf8"))!.records);
    expect(s.exported).toBeGreaterThanOrEqual(3);
  });
});
