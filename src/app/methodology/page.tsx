"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, ChevronDown } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";

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

const HEURISTIC_IDS = [
  // --- Transaction-level heuristics ---
  { id: "H1", titleKey: "methodology.heuristic_h1_title", title: "Round Amount Detection", descKey: "methodology.heuristic_h1_description", desc: "Identifies round-number outputs that suggest intentional payment amounts, including round BTC and round USD/EUR equivalents.", impact: "-5 to -15" },
  { id: "H2", titleKey: "methodology.heuristic_h2_title", title: "Change Detection", descKey: "methodology.heuristic_h2_description", desc: "Identifies likely change outputs using script type matching, value analysis, and the unnecessary input heuristic.", impact: "-5 to -25" },
  { id: "H3", titleKey: "methodology.heuristic_h3_title", title: "Common Input Ownership (CIOH)", descKey: "methodology.heuristic_h3_description", desc: "Evaluates whether all inputs belong to the same entity based on the common input ownership assumption.", impact: "-6 to -45" },
  { id: "H4", titleKey: "methodology.heuristic_h4_title", title: "CoinJoin and PayJoin Detection", descKey: "methodology.heuristic_h4_description", desc: "Detects Whirlpool, WabiSabi, JoinMarket CoinJoin, Stonewall, and PayJoin transactions.", impact: "-3 to +30" },
  { id: "H5", titleKey: "methodology.heuristic_h5_title", title: "Boltzmann Entropy", descKey: "methodology.heuristic_h5_description", desc: "Measures transaction ambiguity using entropy analysis of possible input-output linkage combinations.", impact: "-5 to +15" },
  { id: "H6", titleKey: "methodology.heuristic_h6_title", title: "Fee Analysis", descKey: "methodology.heuristic_h6_description", desc: "Analyzes fee rate precision and RBF signaling to fingerprint wallet software and user behavior.", impact: "-2" },
  { id: "H7", titleKey: "methodology.heuristic_h7_title", title: "OP_RETURN Data Leak", descKey: "methodology.heuristic_h7_description", desc: "Detects metadata embedded in OP_RETURN outputs that may reveal protocols or services used.", impact: "-5 to -8" },
  { id: "H11", titleKey: "methodology.heuristic_h11_title", title: "Wallet Fingerprinting", descKey: "methodology.heuristic_h11_description", desc: "Identifies wallet software from transaction structure, script patterns, and metadata signals.", impact: "-2 to -6" },
  { id: "H12", titleKey: "methodology.heuristic_h12_title", title: "Dust Detection", descKey: "methodology.heuristic_h12_description", desc: "Flags dust-sized outputs that may be tracking attempts by chain surveillance firms.", impact: "-3 to -8" },
  { id: "H14", titleKey: "methodology.heuristic_h14_title", title: "Timing Analysis", descKey: "methodology.heuristic_h14_description", desc: "Evaluates mempool visibility, nLockTime values, and broadcast timing for privacy implications.", impact: "-1 to -3" },
  { id: "H15", titleKey: "methodology.heuristic_h15_title", title: "Script Type Mix Analysis", descKey: "methodology.heuristic_h15_description", desc: "Flags transactions mixing different address formats (P2PKH, P2SH, P2WPKH, P2TR), which aids change detection.", impact: "-8 to +2" },
  { id: "H17", titleKey: "methodology.heuristic_h17_title", title: "Multisig/Escrow Detection", descKey: "methodology.heuristic_h17_description", desc: "Parses multisig inputs to determine M-of-N configuration and detect escrow patterns.", impact: "0 to -3" },
  { id: "CB", titleKey: "methodology.heuristic_cb_title", title: "Coinbase Transaction Detection", descKey: "methodology.heuristic_cb_description", desc: "Identifies mining reward transactions and their privacy implications for the recipient.", impact: "0" },
  { id: "ANON", titleKey: "methodology.heuristic_anon_title", title: "Anonymity Set Analysis", descKey: "methodology.heuristic_anon_description", desc: "Evaluates whether the transaction has meaningful equal-value output groups that provide plausible deniability.", impact: "-1 to +5" },
  { id: "PEEL", titleKey: "methodology.heuristic_peel_title", title: "Peel Chain Detection", descKey: "methodology.heuristic_peel_description", desc: "Detects peel chains where small amounts are repeatedly peeled off a large UTXO across multiple hops.", impact: "-3 to -5" },
  { id: "CONS", titleKey: "methodology.heuristic_cons_title", title: "Consolidation Detection", descKey: "methodology.heuristic_cons_description", desc: "Identifies UTXO consolidation transactions that link multiple addresses to the same wallet.", impact: "-2 to -5" },
  { id: "UI", titleKey: "methodology.heuristic_ui_title", title: "Unnecessary Input Detection", descKey: "methodology.heuristic_ui_description", desc: "Flags transactions where a single input could have funded the payment, revealing additional wallet UTXOs.", impact: "-2 to -3" },
  { id: "TX0", titleKey: "methodology.heuristic_tx0_title", title: "CoinJoin Premix (tx0) Detection", descKey: "methodology.heuristic_tx0_description", desc: "Identifies Whirlpool tx0 premix transactions that prepare UTXOs for CoinJoin rounds.", impact: "-2 to +2" },
  { id: "BIP69", titleKey: "methodology.heuristic_bip69_title", title: "BIP69 Ordering Detection", descKey: "methodology.heuristic_bip69_description", desc: "Detects lexicographic input/output ordering (BIP69) which narrows wallet identification.", impact: "-1" },
  { id: "BIP47", titleKey: "methodology.heuristic_bip47_title", title: "BIP47 Notification Detection", descKey: "methodology.heuristic_bip47_description", desc: "Identifies BIP47 payment code notification transactions.", impact: "0" },
  { id: "XCHG", titleKey: "methodology.heuristic_xchg_title", title: "Exchange Pattern Detection", descKey: "methodology.heuristic_xchg_description", desc: "Identifies patterns typical of exchange deposits and withdrawals.", impact: "-2 to -5" },
  { id: "CSEL", titleKey: "methodology.heuristic_csel_title", title: "Coin Selection Analysis", descKey: "methodology.heuristic_csel_description", desc: "Identifies coin selection algorithms (knapsack, branch-and-bound, FIFO) that fingerprint wallet software.", impact: "-1 to -2" },
  { id: "WIT", titleKey: "methodology.heuristic_wit_title", title: "Witness Data Analysis", descKey: "methodology.heuristic_wit_description", desc: "Analyzes witness stack structure, signature types, and depth patterns for wallet fingerprinting.", impact: "-1 to -3" },
  // --- Address-level heuristics ---
  { id: "H8", titleKey: "methodology.heuristic_h8_title", title: "Address Reuse", descKey: "methodology.heuristic_h8_description", desc: "Identifies address reuse, which deterministically links transactions to the same entity.", impact: "+3 to -93" },
  { id: "H9", titleKey: "methodology.heuristic_h9_title", title: "UTXO Set Analysis", descKey: "methodology.heuristic_h9_description", desc: "Analyzes UTXO set for dust, consolidation risk, and hygiene.", impact: "+2 to -11" },
  { id: "H10", titleKey: "methodology.heuristic_h10_title", title: "Address Type Analysis", descKey: "methodology.heuristic_h10_description", desc: "Evaluates address type (P2PKH, P2SH, P2WPKH, P2TR) for privacy properties and anonymity set size.", impact: "-5 to 0" },
  { id: "H16", titleKey: "methodology.heuristic_h16_title", title: "Spending Pattern Analysis", descKey: "methodology.heuristic_h16_description", desc: "Analyzes spending volume, cold storage patterns, and counterparty exposure at the address level.", impact: "-5 to +2" },
  { id: "REC", titleKey: "methodology.heuristic_rec_title", title: "Recurring Payment Detection", descKey: "methodology.heuristic_rec_description", desc: "Detects recurring payment patterns that reveal regular financial relationships.", impact: "-1 to -3" },
  { id: "HIGH", titleKey: "methodology.heuristic_high_title", title: "High Activity Detection", descKey: "methodology.heuristic_high_description", desc: "Flags addresses with unusually high transaction counts that increase surveillance exposure.", impact: "-2 to -5" },
];

const GRADE_IDS = [
  { grade: "A+", range: ">= 90", color: "text-severity-good", descKey: "methodology.grade_aplus_description", desc: "Excellent privacy - CoinJoin participation, no reuse, high entropy", detailKey: "methodology.grade_aplus_detail", detail: "Uses advanced privacy techniques like CoinJoin that break deterministic transaction links. Minimal metadata exposure and strong anonymity sets make chain analysis unreliable." },
  { grade: "B", range: ">= 75", color: "text-severity-good", descKey: "methodology.grade_b_description", desc: "Good - minor issues, no critical exposure", detailKey: "methodology.grade_b_detail", detail: "No major privacy leaks detected. Minor issues like wallet fingerprinting or non-round change amounts may exist but do not enable confident tracing." },
  { grade: "C", range: ">= 50", color: "text-severity-medium", descKey: "methodology.grade_c_description", desc: "Fair - notable concerns, moderate tracing risk", detailKey: "methodology.grade_c_detail", detail: "Some privacy concerns detected. An analyst could identify patterns like address reuse or change output detection, but the overall picture is still somewhat ambiguous." },
  { grade: "D", range: ">= 25", color: "text-severity-high", descKey: "methodology.grade_d_description", desc: "Poor - significant exposure, confident clustering likely", detailKey: "methodology.grade_d_detail", detail: "Significant privacy failures. Chain surveillance can likely cluster addresses and trace fund flows with moderate to high confidence." },
  { grade: "F", range: "< 25", color: "text-severity-critical", descKey: "methodology.grade_f_description", desc: "Critical - severe failures, trivial to trace", detailKey: "methodology.grade_f_detail", detail: "Severe privacy failures that make tracing trivial. Issues like heavy address reuse, round amounts, and identifiable wallet patterns create a clear picture for any observer." },
];

const CROSS_RULES = [
  { labelKey: "methodology.cross_rule_1_label", label: "CoinJoin suppresses CIOH", textKey: "methodology.cross_rule_1_text", text: "multiple input addresses in a CoinJoin belong to different participants, so the CIOH penalty is zeroed out" },
  { labelKey: "methodology.cross_rule_2_label", label: "CoinJoin suppresses round amounts", textKey: "methodology.cross_rule_2_text", text: "equal outputs in a CoinJoin are the denomination, not a privacy leak" },
  { labelKey: "methodology.cross_rule_3_label", label: "CoinJoin suppresses change detection", textKey: "methodology.cross_rule_3_text", text: "change identification in CoinJoin transactions is unreliable and penalizing it would be misleading" },
  { labelKey: "methodology.cross_rule_4_label", label: "CoinJoin suppresses script type mix", textKey: "methodology.cross_rule_4_text", text: "mixed script types are expected when participants use different wallet software" },
  { labelKey: "methodology.cross_rule_5_label", label: "CoinJoin suppresses wallet fingerprinting", textKey: "methodology.cross_rule_5_text", text: "wallet identification is less relevant when the CoinJoin already breaks transaction graph linkability" },
  { labelKey: "methodology.cross_rule_6_label", label: "CoinJoin suppresses dust detection", textKey: "methodology.cross_rule_6_text", text: "small outputs in CoinJoin transactions are typically coordinator fees, not dusting attacks" },
  { labelKey: "methodology.cross_rule_7_label", label: "CoinJoin suppresses timing analysis", textKey: "methodology.cross_rule_7_text", text: "broadcast timing in CoinJoin is coordinated and does not reveal individual participant behavior" },
  { labelKey: "methodology.cross_rule_8_label", label: "CoinJoin suppresses fee fingerprinting", textKey: "methodology.cross_rule_8_text", text: "fee rate and RBF signals in CoinJoin reveal the coordinator, not the participant's wallet" },
  { labelKey: "methodology.cross_rule_9_label", label: "CoinJoin suppresses no-anonymity-set penalty", textKey: "methodology.cross_rule_9_text", text: "CoinJoin structure provides privacy beyond simple output value matching" },
];

const THREAT_MODEL_ITEMS = [
  { num: "1", labelKey: "methodology.threat_1_label", label: "Cluster addresses", textKey: "methodology.threat_1_text", text: "group addresses controlled by the same entity using CIOH, change detection, and address reuse" },
  { num: "2", labelKey: "methodology.threat_2_label", label: "Link identities", textKey: "methodology.threat_2_text", text: "connect clusters to real people via KYC anchor points (exchange deposits, merchant payments)" },
  { num: "3", labelKey: "methodology.threat_3_label", label: "Trace fund flows", textKey: "methodology.threat_3_text", text: "follow bitcoin through multiple hops using change detection and temporal analysis" },
  { num: "4", labelKey: "methodology.threat_4_label", label: "Profile behavior", textKey: "methodology.threat_4_text", text: "identify spending patterns, wallet software, timing, and financial activity" },
];

const LIMITATIONS = [
  { key: "methodology.limitation_1", text: "Entropy calculation is simplified. Full Boltzmann analysis requires expensive enumeration that is impractical client-side for large transactions." },
  { key: "methodology.limitation_2", text: "Only on-chain data is analyzed. Off-chain intelligence (IP correlations, exchange records, human intelligence) that surveillance firms use is not modeled." },
  { key: "methodology.limitation_3", text: "Wallet fingerprinting covers major wallets but cannot identify all software. Novel or obscure wallets may not be detected." },
  { key: "methodology.limitation_4", text: "Some privacy techniques (like PayJoin) are deliberately undetectable on-chain. A good privacy score does not guarantee privacy, and the absence of detected issues does not mean none exist." },
];

const TOC_ITEMS = [
  { labelKey: "methodology.toc_threat_model", label: "Threat Model", id: "threat-model" },
  { labelKey: "methodology.toc_heuristics", label: "Heuristics", id: "heuristics" },
  { labelKey: "methodology.toc_scoring", label: "Scoring", id: "scoring" },
  { labelKey: "methodology.toc_grades", label: "Grades", id: "grades" },
  { labelKey: "methodology.toc_cross_heuristic", label: "Cross-Heuristic", id: "cross-heuristic" },
  { labelKey: "methodology.toc_limitations", label: "Limitations", id: "limitations" },
];

export default function MethodologyPage() {
  const { t } = useTranslation();
  const [expandedGrade, setExpandedGrade] = useState<string | null>(null);

  const toggleGrade = (grade: string) => {
    setExpandedGrade((prev) => (prev === grade ? null : grade));
  };

  return (
    <PageShell backLabel={t("methodology.back", { defaultValue: "Back to scanner" })}>
        {/* Title */}
        <div className="space-y-3">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            {t("methodology.title", { defaultValue: "Methodology" })}
          </h1>
          <p className="text-muted text-lg leading-relaxed max-w-2xl">
            {t("methodology.subtitle", { defaultValue: "How your Bitcoin privacy is scored. Every heuristic documented, every penalty explained. The same techniques chain surveillance firms use - applied client-side to show you the results." })}
          </p>
        </div>

        {/* Table of contents */}
        <nav className="grid grid-cols-2 sm:flex sm:flex-nowrap gap-2 text-sm sm:overflow-x-auto pb-1 sm:[mask-image:linear-gradient(to_right,black_85%,transparent_100%)] [mask-image:none]" aria-label="Page sections">
          {TOC_ITEMS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="px-3 py-2.5 rounded-lg bg-surface-elevated border border-card-border text-muted hover:text-foreground hover:border-bitcoin/30 transition-all whitespace-nowrap"
            >
              {t(s.labelKey, { defaultValue: s.label })}
            </a>
          ))}
        </nav>

        {/* Threat model */}
        <section id="threat-model" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("methodology.threat_model_heading", { defaultValue: "Threat Model" })}
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p className="text-muted leading-relaxed">
              {t("methodology.threat_model_intro_prefix", {
                defaultValue: "The analysis models the capabilities of",
              })}{" "}
              <strong className="text-foreground">{t("methodology.threat_model_surveillance", { defaultValue: "chain surveillance firms" })}</strong>{" "}
              {t("methodology.threat_model_firms", { defaultValue: "(Chainalysis, Elliptic, CipherTrace)" })}{" "}
              {t("methodology.threat_model_and", { defaultValue: "and" })}{" "}
              <strong className="text-foreground">{t("methodology.threat_model_exchanges", { defaultValue: "KYC-linked exchanges" })}</strong>.{" "}
              {t("methodology.threat_model_suffix", { defaultValue: "These adversaries:" })}
            </p>
            <ul className="space-y-2 text-muted leading-relaxed">
              {THREAT_MODEL_ITEMS.map((item) => (
                <li key={item.num} className="flex gap-2">
                  <span className="text-bitcoin shrink-0">{item.num}.</span>
                  <span>
                    <span className="text-foreground">
                      {t(item.labelKey, { defaultValue: item.label })}
                    </span>
                    {" - "}
                    {t(item.textKey, { defaultValue: item.text })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Heuristics */}
        <section id="heuristics" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("methodology.heuristics_heading", { defaultValue: "Heuristics" })}
          </h2>
          <p className="text-muted leading-relaxed">
            {t("methodology.heuristics_intro", { defaultValue: "The engine implements 30 heuristics that evaluate on-chain privacy - 24 at the transaction level and 6 at the address level. Each produces a score impact applied to a base score of 70." })}
          </p>
          <div className="space-y-3">
            {HEURISTIC_IDS.map((h) => (
              <div
                key={h.id}
                id={h.id.toLowerCase()}
                className="bg-card-bg border border-card-border rounded-xl p-6 space-y-2 hover:border-bitcoin/20 transition-colors"
              >
                <div className="flex items-baseline gap-3">
                  <span className="text-xs font-mono font-bold text-bitcoin bg-bitcoin/10 px-2 py-0.5 rounded shrink-0">
                    {h.id}
                  </span>
                  <h3 className="text-lg font-semibold text-foreground flex-1 min-w-0">
                    {t(h.titleKey, { defaultValue: h.title })}
                  </h3>
                  <span className={`text-sm font-mono shrink-0 ${getImpactColor(h.impact)}`}>
                    {h.impact}
                  </span>
                </div>
                <p className="text-muted text-base leading-relaxed">
                  {t(h.descKey, { defaultValue: h.desc })}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Scoring */}
        <section id="scoring" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("methodology.scoring_heading", { defaultValue: "Scoring Model" })}
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">
                {t("methodology.calculation_heading", { defaultValue: "Calculation" })}
              </h3>
              <p className="text-muted leading-relaxed">
                {t("methodology.calculation_text_prefix", {
                  defaultValue: "Every analysis starts from a",
                })}{" "}
                <strong className="text-foreground">{t("methodology.calculation_base_score", { defaultValue: "base score of 70" })}</strong>{" "}
                {t("methodology.calculation_text_suffix", {
                  defaultValue: "- representing a typical Bitcoin transaction with no obviously good or bad characteristics. The base is above 50 because most transactions are not catastrophically bad; they carry the normal, baseline exposure of a transparent public blockchain.",
                })}
              </p>
              <div className="bg-surface-inset rounded-lg p-4 font-mono text-sm text-foreground">
                {t("methodology.calculation_formula", { defaultValue: "final_score = clamp(70 + sum(all_heuristic_impacts), 0, 100)" })}
              </div>
            </div>
          </div>
        </section>

        {/* Grades */}
        <section id="grades" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("methodology.grades_heading", { defaultValue: "Grade Thresholds" })}
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl overflow-hidden">
            <div className="grid grid-cols-[auto_1fr_1fr] sm:grid-cols-[80px_100px_1fr] text-sm">
              <div className="px-4 py-2.5 bg-surface-inset text-muted font-medium border-b border-card-border">
                {t("methodology.grades_col_grade", { defaultValue: "Grade" })}
              </div>
              <div className="px-4 py-2.5 bg-surface-inset text-muted font-medium border-b border-card-border">
                {t("methodology.grades_col_score", { defaultValue: "Score" })}
              </div>
              <div className="px-4 py-2.5 bg-surface-inset text-muted font-medium border-b border-card-border">
                {t("methodology.grades_col_interpretation", { defaultValue: "Interpretation" })}
              </div>
              {GRADE_IDS.map((g, i) => (
                <div key={g.grade} className="contents">
                  <div className={`px-4 py-3 font-bold text-lg ${g.color} ${i < GRADE_IDS.length - 1 ? "border-b border-card-border" : ""}`}>
                    {g.grade}
                  </div>
                  <div className={`px-4 py-3 font-mono text-muted ${i < GRADE_IDS.length - 1 ? "border-b border-card-border" : ""}`}>
                    {g.range}
                  </div>
                  <div className={`px-4 py-3 text-muted leading-relaxed ${i < GRADE_IDS.length - 1 ? "border-b border-card-border" : ""}`}>
                    <button
                      type="button"
                      className="w-full text-left flex items-start gap-2 cursor-pointer group"
                      onClick={() => toggleGrade(g.grade)}
                      aria-expanded={expandedGrade === g.grade}
                    >
                      <span className="flex-1">
                        {t(g.descKey, { defaultValue: g.desc })}
                      </span>
                      <motion.span
                        className="shrink-0 mt-0.5 text-muted group-hover:text-foreground transition-colors"
                        animate={{ rotate: expandedGrade === g.grade ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <ChevronDown size={16} />
                      </motion.span>
                    </button>
                    <AnimatePresence>
                      {expandedGrade === g.grade && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <p className="mt-2 pt-2 border-t border-card-border text-sm text-muted/80 leading-relaxed">
                            {t(g.detailKey, { defaultValue: g.detail })}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Cross-heuristic intelligence */}
        <section id="cross-heuristic" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("methodology.cross_heuristic_heading", { defaultValue: "Cross-Heuristic Intelligence" })}
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-3">
            <p className="text-muted leading-relaxed">
              {t("methodology.cross_heuristic_intro", { defaultValue: "After all heuristics run, the engine applies cross-heuristic rules to avoid false penalties:" })}
            </p>
            <ul className="space-y-2 text-muted text-base leading-relaxed">
              {CROSS_RULES.map((rule, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="text-bitcoin shrink-0">&bull;</span>
                  <span>
                    <span className="text-foreground font-medium">
                      {t(rule.labelKey, { defaultValue: rule.label })}
                    </span>
                    {" - "}
                    {t(rule.textKey, { defaultValue: rule.text })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Limitations */}
        <section id="limitations" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("methodology.limitations_heading", { defaultValue: "Limitations" })}
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-3">
            <ul className="space-y-2 text-muted text-base leading-relaxed">
              {LIMITATIONS.map((lim, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="text-severity-medium shrink-0">&bull;</span>
                  <span>{t(lim.key, { defaultValue: lim.text })}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Full technical reference link */}
        <div className="flex items-center justify-center py-4">
          <a
            href="https://github.com/Copexit/am-i-exposed/blob/main/docs/privacy-engine.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-bitcoin/10 border border-bitcoin/20 hover:border-bitcoin/40 text-bitcoin/80 hover:text-bitcoin transition-all text-sm"
          >
            {t("methodology.tech_ref_link", { defaultValue: "Full technical reference (privacy-engine.md)" })}
            <ExternalLink size={14} />
          </a>
        </div>

        {/* Bottom CTA */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2 pb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-bitcoin text-background font-medium text-sm hover:bg-bitcoin/90 transition-colors"
          >
            {t("common.scanNow", { defaultValue: "Scan now" })}
          </Link>
          <Link
            href="/faq"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-surface-elevated border border-card-border text-muted hover:text-foreground hover:border-bitcoin/30 transition-all text-sm"
          >
            {t("nav.faq", { defaultValue: "FAQ" })}
          </Link>
        </div>
    </PageShell>
  );
}
