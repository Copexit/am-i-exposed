"use client";

import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Map impact range to appropriate severity color. */
function getImpactColor(impact: string): string {
  if (impact.startsWith("+")) return "text-severity-good";
  if (impact.includes("+")) return "text-severity-medium"; // mixed like "-5 to +15"
  // Parse max negative impact from strings like "-20 to -70"
  const nums = impact.match(/-(\d+)/g)?.map((n) => Math.abs(parseInt(n, 10))) ?? [];
  const maxNeg = Math.max(...nums, 0);
  if (maxNeg >= 15) return "text-severity-critical";
  if (maxNeg >= 8) return "text-severity-high";
  return "text-severity-medium";
}

const HEURISTICS = [
  {
    id: "H1",
    title: "Round Amount Detection",
    impact: "-5 to -15",
    description:
      "Flags outputs matching common round BTC or satoshi values. Round amounts typically indicate the payment (not change), letting an observer determine fund flow direction.",
  },
  {
    id: "H2",
    title: "Change Detection",
    impact: "-5 to -15",
    description:
      "Identifies which output returns funds to the sender using address type matching, round amount analysis, unnecessary input heuristics, and output ordering patterns. Correct change identification enables multi-hop tracing.",
  },
  {
    id: "H3",
    title: "Common Input Ownership (CIOH)",
    impact: "-3 to -15",
    description:
      "If a transaction spends multiple inputs, all inputs are assumed to belong to the same entity. This is the foundational clustering heuristic - the single most powerful tool in chain surveillance. Applied transitively across transactions to build massive address clusters.",
  },
  {
    id: "H4",
    title: "CoinJoin Detection",
    impact: "+15 to +30",
    description:
      "Detects Whirlpool (5 equal outputs at known denominations) and WabiSabi/Wasabi (large input/output sets with equal-value groups) CoinJoin transactions. CoinJoin is the only heuristic that increases the privacy score.",
  },
  {
    id: "H5",
    title: "Simplified Entropy (Boltzmann)",
    impact: "-5 to +15",
    description:
      "Measures how many valid input-to-output mappings exist. Higher entropy means more ambiguity for adversaries. Uses exact enumeration for small transactions and structural estimation for large ones.",
  },
  {
    id: "H6",
    title: "Fee Analysis",
    impact: "-1 to -3",
    description:
      "Examines fee rate precision and RBF signaling. Round fee rates and specific RBF patterns help identify wallet software, reducing the anonymity set.",
  },
  {
    id: "H7",
    title: "OP_RETURN Detection",
    impact: "-5 to -8 per output",
    description:
      "Identifies embedded data in OP_RETURN outputs - protocol markers (Omni, OpenTimestamps, Counterparty, Runes, Ordinals) and arbitrary text. Permanently visible metadata that distinguishes the transaction. Impact stacks with multiple OP_RETURN outputs.",
  },
  {
    id: "H8",
    title: "Address Reuse",
    impact: "-24 to -70",
    description:
      "Detects addresses that have received funds in more than one transaction. Address reuse is the single most damaging privacy behavior - it creates deterministic, irrefutable links between all transactions. Carries the harshest penalty, scaling with the number of reuses.",
  },
  {
    id: "H9",
    title: "UTXO Analysis",
    impact: "-2 to -11",
    description:
      "Evaluates the UTXO set for count, value distribution, dust detection, and consolidation risk. Large UTXO counts represent future privacy damage if consolidated carelessly.",
  },
  {
    id: "H10",
    title: "Address Type Analysis",
    impact: "-5 to +5",
    description:
      "Assesses the address format: Taproot (P2TR) provides the best privacy since all spend types look identical. Native SegWit (P2WPKH) is good. Legacy (P2PKH) and wrapped (P2SH) leak more information.",
  },
  {
    id: "H11",
    title: "Wallet Fingerprinting",
    impact: "-2 to -8",
    description:
      "Identifies wallet software through nLockTime, nSequence, BIP69 ordering, and low-R signature grinding. Approximately 45% of transactions are identifiable by wallet software from structure alone.",
  },
  {
    id: "H12",
    title: "Dust Detection",
    impact: "-3 to -8",
    description:
      "Flags tiny UTXOs (under 1000 sats) as potential dusting attacks - an active surveillance technique where adversaries send small amounts that, when spent alongside other UTXOs, link addresses via CIOH.",
  },
  {
    id: "H13",
    title: "Anonymity Set Analysis",
    impact: "-1 to +5",
    description:
      "Calculates how many outputs share the same value, making them indistinguishable. Higher anonymity sets (as in CoinJoin) mean more possible interpretations of fund flow. Outputs with unique values have an anonymity set of 1 and are trivially traceable.",
  },
  {
    id: "H14",
    title: "Timing Analysis",
    impact: "-2 to -3",
    description:
      "Examines transaction timing patterns including broadcast recency (unconfirmed transactions risk IP correlation), locktime anomalies, and stale nLockTime values that can fingerprint wallet software.",
  },
  {
    id: "H15",
    title: "Script Type Mix",
    impact: "-8 to +2",
    description:
      "Checks whether inputs and outputs use the same script type. Mixed script types (e.g., P2WPKH input with P2TR output) make change detection easier. Uniform script types improve ambiguity. Also flags bare multisig outputs.",
  },
  {
    id: "H16",
    title: "Spending Pattern Analysis",
    impact: "-3 to +2",
    description:
      "Address-level analysis of spending behavior including transaction volume, UTXO turnover rate, and counterparty diversity. High-volume addresses or accounts that never spend may indicate specific usage patterns like exchanges or cold storage.",
  },
];

const GRADES = [
  { grade: "A+", range: ">= 90", color: "text-severity-good", description: "Excellent privacy - CoinJoin, Taproot, no reuse, high entropy" },
  { grade: "B", range: ">= 75", color: "text-severity-good", description: "Good - minor issues, no critical exposure" },
  { grade: "C", range: ">= 50", color: "text-severity-medium", description: "Fair - notable concerns, moderate tracing risk" },
  { grade: "D", range: ">= 25", color: "text-severity-high", description: "Poor - significant exposure, confident clustering likely" },
  { grade: "F", range: "< 25", color: "text-severity-critical", description: "Critical - severe failures, trivial to trace" },
];

export default function MethodologyPage() {
  const { t, i18n } = useTranslation();
  const isEnglish = i18n.language?.startsWith("en") ?? true;

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-4xl space-y-10">
        {/* Back nav */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors py-2 -my-2"
        >
          <ArrowLeft size={16} />
          {t("methodology.back", { defaultValue: "Back to scanner" })}
        </Link>

        {/* Title */}
        <div className="space-y-3">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            {t("methodology.title", { defaultValue: "Methodology" })}
          </h1>
          {!isEnglish && (
            <p className="text-sm text-severity-medium bg-severity-medium/10 border border-severity-medium/20 rounded-lg px-4 py-2.5">
              {t("methodology.english_only", { defaultValue: "This page is currently available in English only. Translation coming soon." })}
            </p>
          )}
          <p className="text-muted text-lg leading-relaxed max-w-2xl">
            How your Bitcoin privacy is scored. Every heuristic documented,
            every penalty explained. The same techniques chain
            surveillance firms use - applied client-side to show you the results.
          </p>
        </div>

        {/* Table of contents */}
        <nav className="flex flex-wrap gap-2 text-sm" aria-label="Page sections">
          {[
            { label: "Threat Model", id: "threat-model" },
            { label: "Heuristics", id: "heuristics" },
            { label: "Scoring", id: "scoring" },
            { label: "Grades", id: "grades" },
            { label: "Cross-Heuristic", id: "cross-heuristic" },
            { label: "Limitations", id: "limitations" },
          ].map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="px-3 py-2.5 rounded-lg bg-surface-elevated border border-card-border text-muted hover:text-foreground hover:border-bitcoin/30 transition-all"
            >
              {s.label}
            </a>
          ))}
        </nav>

        {/* Threat model */}
        <section id="threat-model" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Threat Model</h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p className="text-muted leading-relaxed">
              The analysis models the capabilities of <span className="text-foreground font-medium">chain surveillance firms</span> (Chainalysis, Elliptic, CipherTrace) and <span className="text-foreground font-medium">KYC-linked exchanges</span>. These adversaries:
            </p>
            <ul className="space-y-2 text-muted leading-relaxed">
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0">1.</span>
                <span><span className="text-foreground">Cluster addresses</span> - group addresses controlled by the same entity using CIOH, change detection, and address reuse</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0">2.</span>
                <span><span className="text-foreground">Link identities</span> - connect clusters to real people via KYC anchor points (exchange deposits, merchant payments)</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0">3.</span>
                <span><span className="text-foreground">Trace fund flows</span> - follow bitcoin through multiple hops using change detection and temporal analysis</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0">4.</span>
                <span><span className="text-foreground">Profile behavior</span> - identify spending patterns, wallet software, timing, and financial activity</span>
              </li>
            </ul>
          </div>
        </section>

        {/* Heuristics */}
        <section id="heuristics" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Heuristics</h2>
          <p className="text-muted leading-relaxed">
            The engine implements 16 heuristics that evaluate on-chain privacy - 12 at the transaction level and 4 at the address level.
            Each produces a score impact applied to a base score of 70.
          </p>
          <div className="space-y-3">
            {HEURISTICS.map((h) => (
              <div
                key={h.id}
                id={h.id.toLowerCase()}
                className="bg-card-bg border border-card-border rounded-xl p-6 space-y-2 hover:border-bitcoin/20 transition-colors"
              >
                <div className="flex items-baseline gap-3">
                  <span className="text-xs font-mono font-bold text-bitcoin bg-bitcoin/10 px-2 py-0.5 rounded shrink-0">
                    {h.id}
                  </span>
                  <h3 className="text-lg font-semibold text-foreground flex-1 min-w-0">{h.title}</h3>
                  <span className={`text-sm font-mono shrink-0 ${getImpactColor(h.impact)}`}>
                    {h.impact}
                  </span>
                </div>
                <p className="text-muted text-base leading-relaxed">
                  {h.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Scoring */}
        <section id="scoring" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Scoring Model</h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">Calculation</h3>
              <p className="text-muted leading-relaxed">
                Every analysis starts from a <span className="text-foreground font-medium">base score of 70</span> - representing a typical Bitcoin transaction with no obviously good or bad characteristics. The base is above 50 because most transactions are not catastrophically bad; they carry the normal, baseline exposure of a transparent public blockchain.
              </p>
              <div className="bg-surface-inset rounded-lg p-4 font-mono text-sm text-foreground">
                final_score = clamp(70 + sum(all_heuristic_impacts), 0, 100)
              </div>
            </div>
          </div>
        </section>

        {/* Grades */}
        <section id="grades" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Grade Thresholds</h2>
          <div className="bg-card-bg border border-card-border rounded-xl overflow-hidden">
            <div className="grid grid-cols-[auto_1fr_1fr] sm:grid-cols-[80px_100px_1fr] text-sm">
              <div className="px-4 py-2.5 bg-surface-inset text-muted font-medium border-b border-card-border">Grade</div>
              <div className="px-4 py-2.5 bg-surface-inset text-muted font-medium border-b border-card-border">Score</div>
              <div className="px-4 py-2.5 bg-surface-inset text-muted font-medium border-b border-card-border">Interpretation</div>
              {GRADES.map((g, i) => (
                <div key={g.grade} className="contents">
                  <div className={`px-4 py-3 font-bold text-lg ${g.color} ${i < GRADES.length - 1 ? "border-b border-card-border" : ""}`}>
                    {g.grade}
                  </div>
                  <div className={`px-4 py-3 font-mono text-muted ${i < GRADES.length - 1 ? "border-b border-card-border" : ""}`}>
                    {g.range}
                  </div>
                  <div className={`px-4 py-3 text-muted leading-relaxed ${i < GRADES.length - 1 ? "border-b border-card-border" : ""}`}>
                    {g.description}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Cross-heuristic intelligence */}
        <section id="cross-heuristic" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Cross-Heuristic Intelligence</h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-3">
            <p className="text-muted leading-relaxed">
              After all heuristics run, the engine applies cross-heuristic rules to avoid false penalties:
            </p>
            <ul className="space-y-2 text-muted text-base leading-relaxed">
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0">&bull;</span>
                <span><span className="text-foreground font-medium">CoinJoin suppresses CIOH</span> - multiple input addresses in a CoinJoin belong to different participants, so the CIOH penalty is zeroed out</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0">&bull;</span>
                <span><span className="text-foreground font-medium">CoinJoin suppresses round amounts</span> - equal outputs in a CoinJoin are the denomination, not a privacy leak</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0">&bull;</span>
                <span><span className="text-foreground font-medium">CoinJoin suppresses change detection</span> - change identification in CoinJoin transactions is unreliable and penalizing it would be misleading</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0">&bull;</span>
                <span><span className="text-foreground font-medium">CoinJoin suppresses script type mix</span> - mixed script types are expected when participants use different wallet software</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0">&bull;</span>
                <span><span className="text-foreground font-medium">CoinJoin suppresses wallet fingerprinting</span> - wallet identification is less relevant when the CoinJoin already breaks transaction graph linkability</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0">&bull;</span>
                <span><span className="text-foreground font-medium">CoinJoin suppresses dust detection</span> - small outputs in CoinJoin transactions are typically coordinator fees, not dusting attacks</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0">&bull;</span>
                <span><span className="text-foreground font-medium">CoinJoin suppresses timing analysis</span> - broadcast timing in CoinJoin is coordinated and does not reveal individual participant behavior</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0">&bull;</span>
                <span><span className="text-foreground font-medium">CoinJoin suppresses fee fingerprinting</span> - fee rate and RBF signals in CoinJoin reveal the coordinator, not the participant&apos;s wallet</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0">&bull;</span>
                <span><span className="text-foreground font-medium">CoinJoin suppresses no-anonymity-set penalty</span> - CoinJoin structure provides privacy beyond simple output value matching</span>
              </li>
            </ul>
          </div>
        </section>

        {/* Limitations */}
        <section id="limitations" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Limitations</h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-3">
            <ul className="space-y-2 text-muted text-base leading-relaxed">
              <li className="flex gap-2">
                <span className="text-severity-medium shrink-0">&bull;</span>
                <span>Entropy calculation is simplified. Full Boltzmann analysis requires expensive enumeration that is impractical client-side for large transactions.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-severity-medium shrink-0">&bull;</span>
                <span>Only on-chain data is analyzed. Off-chain intelligence (IP correlations, exchange records, human intelligence) that surveillance firms use is not modeled.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-severity-medium shrink-0">&bull;</span>
                <span>Wallet fingerprinting covers major wallets but cannot identify all software. Novel or obscure wallets may not be detected.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-severity-medium shrink-0">&bull;</span>
                <span>Some privacy techniques (like PayJoin) are deliberately undetectable on-chain. A good privacy score does not guarantee privacy, and the absence of detected issues does not mean none exist.</span>
              </li>
            </ul>
          </div>
        </section>

        {/* Full technical reference link */}
        <div className="flex items-center justify-center py-4">
          <a
            href="https://github.com/Copexit/am-i-exposed/blob/main/privacy_engine.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-bitcoin/10 border border-bitcoin/20 hover:border-bitcoin/40 text-bitcoin/80 hover:text-bitcoin transition-all text-sm"
          >
            Full technical reference (privacy_engine.md)
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </div>
  );
}
