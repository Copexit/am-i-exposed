import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import i18next from "i18next";
import { findingKeys } from "../finding-utils";
import type { Finding } from "../types";
import {
  makeTx, makeVin, makeVout, makeAddress, resetAddrCounter,
} from "../analysis/heuristics/__tests__/fixtures/tx-factory";

vi.mock("@/lib/analysis/entity-filter/entity-match", () => ({
  matchEntitySync: vi.fn(() => null),
  detectEntityBehavior: vi.fn(() => null),
}));
vi.mock("@/lib/analysis/entities", () => ({ getEntity: vi.fn(() => undefined) }));

import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { getEntity } from "@/lib/analysis/entities";
import { buildLinkabilityMatrix } from "../analysis/chain/linkability";
import { applyCoinJoinSuppressions } from "../analysis/cross-heuristic/coinjoin-suppressions";
import { analyzeCoinJoinPremix } from "../analysis/heuristics/coinjoin-premix";
import { analyzeFees } from "../analysis/heuristics/fee-analysis";
import { applyCompoundScoringAdjustments } from "../analysis/cross-heuristic/compound-scoring";
import { applyBehavioralRollup } from "../analysis/cross-heuristic/behavioral-rollup";
import { analyzeEntityDetection } from "../analysis/heuristics/entity-detection";
import { analyzeEntropy } from "../analysis/heuristics/entropy";
import { analyzeDustOutputs } from "../analysis/heuristics/dust-output";
import { analyzeAddress } from "../analysis/orchestrator";
import { analyzeBip47Notification } from "../analysis/heuristics/bip47-notification";
import { enrichBip47Finding } from "../analysis/enrichment";
import { makeIncompletePrevoutFinding } from "../analysis/analysis-state";
import { buildCluster } from "../analysis/chain/clustering";
import type { ApiClient } from "../api/client";

const locale = (lang: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "public/locales", lang, "common.json"), "utf8")) as Record<string, string>;

const i18n = i18next.createInstance();
// initAsync: false - resources are ready synchronously.
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  initAsync: false,
  resources: { en: { translation: locale("en") }, es: { translation: locale("es") }, pl: { translation: locale("pl") } },
  interpolation: { escapeValue: false },
});

/** Render a finding the way FindingCard does (locale key first, English text as default). */
function render(f: Finding | undefined, lng = "en") {
  if (!f) throw new Error("finding not emitted");
  const field = (name: "title" | "description" | "recommendation") =>
    i18n.t(findingKeys(f.id, name, f.params), { ...f.params, lng, defaultValue: f[name] });
  return { title: field("title"), description: field("description"), recommendation: field("recommendation") };
}

const addrVin = (address: string, value: number) =>
  makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: address, value } });

beforeEach(() => {
  resetAddrCounter();
  vi.mocked(matchEntitySync).mockReturnValue(null);
  vi.mocked(getEntity).mockReturnValue(undefined);
});

describe("finding locale text keeps the heuristic's information", () => {
  const linkTx = () => makeTx({
    vin: [10_000, 50_000, 50_000, 50_000].map((v) => makeVin({ prevout: { ...makeVin().prevout!, value: v } })),
    vout: [50_000, 50_000, 50_000, 5_000].map((v) => makeVout({ value: v })),
  });

  it("linkability-equal-subset lists the linked pairs", () => {
    const f = buildLinkabilityMatrix(linkTx())!.findings.find((x) => x.id === "linkability-equal-subset");
    expect(render(f).description).toContain("input[0] -> output[3]");
  });

  it("linkability-deterministic states the interpretation count", () => {
    const f = buildLinkabilityMatrix(linkTx())!.findings.find((x) => x.id === "linkability-deterministic")!;
    expect(render(f).description).toContain(`hold in all ${f.params!.interpretations} valid interpretations`);
  });

  it("linkability findings on a CoinJoin keep the post-mix recommendation", () => {
    const findings = buildLinkabilityMatrix(linkTx())!.findings;
    expect(render(findings.find((x) => x.id === "linkability-deterministic")).recommendation).toContain("Despite the CoinJoin structure");
    applyCoinJoinSuppressions(findings, false);
    expect(render(findings.find((x) => x.id === "linkability-deterministic")).recommendation).toContain("Spend post-mix outputs individually");
    expect(render(findings.find((x) => x.id === "linkability-equal-subset")).recommendation).toContain("expected for change/fee outputs");
  });

  const tx0 = (outs: number[]) => analyzeCoinJoinPremix(makeTx({
    vin: [addrVin("bc1qsender0000000000000000000000000000001", outs.reduce((s, v) => s + v, 1_500))],
    vout: outs.map((v) => makeVout({ value: v })),
    fee: 1_500,
  })).findings[0];

  it("tx0-premix with toxic change warns about it, with formatted sats", () => {
    const f = tx0([1_000_000, 1_000_000, 1_000_000, 50_000, 448_500]);
    const text = render(f);
    expect(text.description).toContain("toxic change output (448,500 sats)");
    expect(render(f, "es").description).toContain("(448.500 sats) NO se mezcla");
    expect(text.description).toContain("Coordinator fee: 50,000 sats");
    expect(text.recommendation).toContain("undoes all CoinJoin privacy gains");
  });

  it("tx0-premix without toxic change says so", () => {
    const text = render(tx0([1_000_000, 1_000_000, 50_000]));
    expect(text.description).not.toContain("toxic");
    expect(text.recommendation).toContain("No toxic change detected");
  });

  it("h6-cpfp-detected mentions a parent that signaled RBF", () => {
    const parentTx = makeTx({
      txid: "p".repeat(64), fee: 200, weight: 400,
      vin: [makeVin({ sequence: 0xfffffffd })],
      vout: [makeVout({ value: 500_000 }), makeVout({ value: 100_000 })],
    });
    const child = makeTx({ weight: 400, fee: 800, vin: [makeVin({ txid: parentTx.txid, vout: 1, sequence: 0xfffffffe })] });
    const f = analyzeFees(child, undefined, { parentTx }).findings.find((x) => x.id === "h6-cpfp-detected");
    expect(render(f).description).toContain("The parent had RBF signaled but CPFP was used instead");
  });

  it("behavioral-fingerprint-rollup notes 4+ signals", () => {
    const ids = ["h11-wallet-fingerprint", "h6-round-fee-rate", "h6-rbf-signaled", "bip69-detected"];
    const findings = ids.map((id) => ({ id, severity: "low", confidence: "high", title: "", description: "", recommendation: "", scoreImpact: -1 }) as Finding);
    applyBehavioralRollup(findings);
    expect(render(findings.find((x) => x.id === "behavioral-fingerprint-rollup")).description).toContain("With 4+ signals");
  });

  describe("entity matches", () => {
    const a1 = "bc1qentityaddressnumberone000000000000000";
    const a2 = "bc1qentityaddressnumbertwo000000000000000";
    const scan = (ofac: boolean) => {
      vi.mocked(matchEntitySync).mockImplementation((address) =>
        address === a1 || address === a2 ? { address, entityName: "Binance", category: "exchange", ofac, confidence: "high" } : null);
      return analyzeEntityDetection(makeTx({ vin: [addrVin(a1, 100_000)], vout: [makeVout({ scriptpubkey_address: a2 })] })).findings;
    };

    it("entity-ofac-match: plural title, shortened addresses", () => {
      const text = render(scan(true).find((x) => x.id === "entity-ofac-match"));
      expect(text.title).toBe("OFAC sanctioned addresses detected");
      expect(text.description).toContain(`${a1.slice(0, 12)}...`);
      expect(text.description).not.toContain(a1);
    });

    it("entity-known-input/output: shortened address and false positive rate", () => {
      const findings = scan(false);
      for (const id of ["entity-known-input", "entity-known-output"]) {
        const text = render(findings.find((x) => x.id === id));
        expect(text.description).toContain("...");
        expect(text.description).not.toContain(a1);
        expect(text.description).not.toContain(a2);
        expect(text.description).toContain("0.1% false positive rate");
        expect(render(findings.find((x) => x.id === id), "es").description).toMatch(/falsos positivos del 0,1\s%/);
      }
    });
  });

  describe("address-entity-identified", () => {
    const scanAddress = async (ofac: boolean, country?: string) => {
      const address = "bc1qidentifiedaddress00000000000000000000";
      vi.mocked(matchEntitySync).mockReturnValue({ address, entityName: "Kraken", category: "exchange", ofac, confidence: "high" });
      vi.mocked(getEntity).mockReturnValue(country ? { name: "Kraken", category: "exchange", country, status: "active", ofac } as never : undefined);
      const result = await analyzeAddress(makeAddress({ address }), [], []);
      return render(result.findings.find((x) => x.id === "address-entity-identified"), "es");
    };

    it("OFAC match uses the sanctioned text", async () => {
      const text = await scanAddress(true);
      expect(text.title).toBe("Entidad sancionada por OFAC: Kraken");
      expect(text.recommendation).toContain("Consulta a un abogado");
    });

    it("known entity includes its country", async () => {
      const text = await scanAddress(false, "United States");
      expect(text.title).toBe("Entidad identificada: Kraken");
      expect(text.description).toContain("(exchange, United States)");
    });

    it("known entity without a country", async () => {
      expect((await scanAddress(false)).description).toContain("Kraken (exchange).");
    });
  });

  it("h5-zero-entropy: merged self-transfer text", () => {
    const tx = makeTx({ vin: [addrVin("bc1qsame", 60_000), addrVin("bc1qsame", 40_000)], vout: [makeVout({ value: 98_000 })] });
    const text = render(analyzeEntropy(tx).findings.find((x) => x.id === "h5-zero-entropy"));
    expect(text.description).toContain("come from one address");
    expect(text.recommendation).not.toContain("Single-input, single-output");
  });

  it("h5-zero-entropy: plain 1-in/1-out keeps the typical cases", () => {
    const tx = makeTx({ vin: [makeVin()], vout: [makeVout({ value: 98_000 })] });
    const text = render(analyzeEntropy(tx).findings.find((x) => x.id === "h5-zero-entropy"));
    expect(text.description).toContain("sweep transactions, exact-amount payments, or wallet migrations");
    expect(text.recommendation).toContain("PayJoin/Stowaway");
  });

  it("dust-attack counts only dust sent to others", () => {
    const self = "bc1qselfpaid";
    const tx = makeTx({
      vin: [addrVin(self, 200_000)],
      vout: [
        ...Array.from({ length: 6 }, () => makeVout({ value: 500 })),
        makeVout({ value: 546, scriptpubkey_address: self }),
        makeVout({ value: 190_000 }),
      ],
    });
    const f = analyzeDustOutputs(tx).findings.find((x) => x.id === "dust-attack")!;
    expect(render(f).title).toBe("Possible dust attack (3000 sats)");
    expect(f.params!.dustIndices).toBe("0,1,2,3,4,5");
  });

  describe("no raw placeholders, text in the viewer's language", () => {
    const noPlaceholders = (f: Finding) => {
      for (const lng of ["en", "es"]) {
        const text = render(f, lng);
        for (const v of Object.values(text)) expect(v, `${f.id} ${lng}`).not.toContain("{{");
      }
    };

    const opReturn = {
      scriptpubkey: "6a4c50" + "a".repeat(160), scriptpubkey_asm: "", scriptpubkey_type: "op_return", scriptpubkey_address: "", value: 0,
    };
    const bip47 = (vout: ReturnType<typeof makeVout>[]) =>
      analyzeBip47Notification(makeTx({ vin: [makeVin()], vout: [opReturn, ...vout] })).findings[0]!;

    it("bip47-notification without enrichment", () => {
      noPlaceholders(bip47([makeVout({ value: 546 }), makeVout({ value: 90_000 })]));
      noPlaceholders(bip47([makeVout({ value: 546 })]));
    });

    it("bip47-notification without a notification output does not claim one", () => {
      const f = bip47([makeVout({ value: 90_000 })]);
      noPlaceholders(f);
      expect(render(f).description).not.toContain(" 0 sats");
      expect(render(f, "es").description).not.toContain(" 0 sats");
    });

    it("bip47-notification channel info is localized", async () => {
      const f = bip47([makeVout({ value: 546 }), makeVout({ value: 90_000 })]);
      const getAddress = vi.fn().mockResolvedValue(makeAddress({
        chain_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 5 },
      }));
      await enrichBip47Finding([f], { getAddress } as unknown as ApiClient, new AbortController().signal);
      noPlaceholders(f);
      expect(render(f).description).toContain("5 BIP47 payment channels");
      expect(render(f, "es").description).toContain("5 canales de pago BIP47");
    });

    it("api-incomplete-prevout states the count", () => {
      const f = makeIncompletePrevoutFinding(3);
      noPlaceholders(f);
      expect(render(f).description).toContain("3 transaction inputs");
    });

    it("chain-cluster-size counts the other addresses and keeps tier advice", () => {
      const addrs = ["bc1qa", "bc1qb", "bc1qc", "bc1qd", "bc1qe"];
      const tx = makeTx({ vin: addrs.map((x) => addrVin(x, 10_000)), vout: [makeVout()] });
      const f = buildCluster("bc1qa", new Map([["bc1qa", [tx]]])).findings[0]!;
      noPlaceholders(f);
      expect(render(f).description).toContain("with 4 other addresses");
      expect(render(f).recommendation).toContain("Label and spend them individually");
    });

    it("dust-outputs title is translated, CoinJoin title reachable", () => {
      const tx = makeTx({ vin: [addrVin("bc1qdustsender", 100_000)], vout: [makeVout({ value: 700 }), makeVout({ value: 50_000 }), makeVout({ value: 40_000 })] });
      const findings = analyzeDustOutputs(tx).findings.filter((x) => x.id === "dust-outputs");
      expect(render(findings[0], "es").title).toBe("1 salida de polvo detectada (< 1000 sats)");
      applyCoinJoinSuppressions(findings, false);
      expect(render(findings[0], "es").title).toContain("CoinJoin");
    });

    it("dust-outputs title stays Polish for 2-4 and 5+ dust outputs (pl _few/_many)", () => {
      for (const n of [3, 5]) {
        // More regular outputs than dust, so this is not a batch dust attack
        const vout = [...Array.from({ length: n }, () => makeVout({ value: 700 })), ...Array.from({ length: n + 1 }, () => makeVout({ value: 20_000 }))];
        const tx = makeTx({ vin: [addrVin("bc1qdustsender", 200_000)], vout });
        const f = analyzeDustOutputs(tx).findings.find((x) => x.id === "dust-outputs");
        expect(render(f, "pl").title).toMatch(/^Wykryto \d+ wyj/);
      }
    });

    it("h9-dust-detected title is translated (plural keys get a count)", async () => {
      const address = makeAddress({ address: "bc1qdusty" });
      const utxo = (value: number, i: number) => ({ txid: String(i).repeat(64), vout: 0, value, status: { confirmed: true } });
      for (const [n, lng, expected] of [[1, "es", /^1 salida sospechosa/], [3, "es", /^3 salidas sospechosas/], [3, "pl", /^Wykryto 3 podejrzane/], [5, "pl", /^Wykryto 5 podejrzanych/]] as const) {
        const result = await analyzeAddress(address, Array.from({ length: n }, (_, i) => utxo(500, i)), []);
        expect(render(result.findings.find((x) => x.id === "h9-dust-detected"), lng).title).toMatch(expected);
      }
    });

    it("h5-entropy on a Stonewall has Stonewall text in every field", () => {
      const f: Finding = {
        id: "h5-entropy", severity: "low", title: "", description: "d", recommendation: "r", scoreImpact: 1,
        params: { entropy: 1.58, method: "exact", interpretations: 3, context: "low", entropyPerUtxo: 0.2, nUtxos: 8 },
      };
      applyCoinJoinSuppressions([f], true);
      expect(render(f).description).toContain("Stonewall");
      expect(render(f, "es").description).toContain("Stonewall");
      expect(render(f, "es").recommendation).toContain("Stonewall");
    });

    it("h2-change-detected explains the RBF compound", () => {
      const f: Finding = {
        id: "h2-change-detected", severity: "medium", title: "", description: "", recommendation: "", scoreImpact: -5,
        params: { signalCount: 2, confidence: "medium" },
      };
      applyCompoundScoringAdjustments([{ id: "h6-rbf-signaled", severity: "low", title: "", description: "", recommendation: "", scoreImpact: -1 }, f]);
      expect(render(f).description).toContain("RBF");
      expect(render(f, "es").description).toContain("RBF");
    });
  });
});
