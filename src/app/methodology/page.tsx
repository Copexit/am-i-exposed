"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, ChevronDown } from "lucide-react";
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
  { id: "H1", titleKey: "methodology.heuristic_h1_title", descKey: "methodology.heuristic_h1_description", impact: "-5 to -15" },
  { id: "H2", titleKey: "methodology.heuristic_h2_title", descKey: "methodology.heuristic_h2_description", impact: "-5 to -30" },
  { id: "H3", titleKey: "methodology.heuristic_h3_title", descKey: "methodology.heuristic_h3_description", impact: "-3 to -15" },
  { id: "H4", titleKey: "methodology.heuristic_h4_title", descKey: "methodology.heuristic_h4_description", impact: "+15 to +30" },
  { id: "H5", titleKey: "methodology.heuristic_h5_title", descKey: "methodology.heuristic_h5_description", impact: "-5 to +15" },
  { id: "H6", titleKey: "methodology.heuristic_h6_title", descKey: "methodology.heuristic_h6_description", impact: "-1 to -3" },
  { id: "H7", titleKey: "methodology.heuristic_h7_title", descKey: "methodology.heuristic_h7_description", impact: "-5 to -8 per output" },
  { id: "H8", titleKey: "methodology.heuristic_h8_title", descKey: "methodology.heuristic_h8_description", impact: "-24 to -70" },
  { id: "H9", titleKey: "methodology.heuristic_h9_title", descKey: "methodology.heuristic_h9_description", impact: "-2 to -11" },
  { id: "H10", titleKey: "methodology.heuristic_h10_title", descKey: "methodology.heuristic_h10_description", impact: "-5 to +5" },
  { id: "H11", titleKey: "methodology.heuristic_h11_title", descKey: "methodology.heuristic_h11_description", impact: "-2 to -8" },
  { id: "H12", titleKey: "methodology.heuristic_h12_title", descKey: "methodology.heuristic_h12_description", impact: "-3 to -8" },
  { id: "H13", titleKey: "methodology.heuristic_h13_title", descKey: "methodology.heuristic_h13_description", impact: "-1 to +5" },
  { id: "H14", titleKey: "methodology.heuristic_h14_title", descKey: "methodology.heuristic_h14_description", impact: "-2 to -3" },
  { id: "H15", titleKey: "methodology.heuristic_h15_title", descKey: "methodology.heuristic_h15_description", impact: "-8 to +2" },
  { id: "H16", titleKey: "methodology.heuristic_h16_title", descKey: "methodology.heuristic_h16_description", impact: "-3 to +2" },
];

const GRADE_IDS = [
  { grade: "A+", range: ">= 90", color: "text-severity-good", descKey: "methodology.grade_aplus_description", detailKey: "methodology.grade_aplus_detail" },
  { grade: "B", range: ">= 75", color: "text-severity-good", descKey: "methodology.grade_b_description", detailKey: "methodology.grade_b_detail" },
  { grade: "C", range: ">= 50", color: "text-severity-medium", descKey: "methodology.grade_c_description", detailKey: "methodology.grade_c_detail" },
  { grade: "D", range: ">= 25", color: "text-severity-high", descKey: "methodology.grade_d_description", detailKey: "methodology.grade_d_detail" },
  { grade: "F", range: "< 25", color: "text-severity-critical", descKey: "methodology.grade_f_description", detailKey: "methodology.grade_f_detail" },
];

const CROSS_RULES = [
  { labelKey: "methodology.cross_rule_1_label", textKey: "methodology.cross_rule_1_text" },
  { labelKey: "methodology.cross_rule_2_label", textKey: "methodology.cross_rule_2_text" },
  { labelKey: "methodology.cross_rule_3_label", textKey: "methodology.cross_rule_3_text" },
  { labelKey: "methodology.cross_rule_4_label", textKey: "methodology.cross_rule_4_text" },
  { labelKey: "methodology.cross_rule_5_label", textKey: "methodology.cross_rule_5_text" },
  { labelKey: "methodology.cross_rule_6_label", textKey: "methodology.cross_rule_6_text" },
  { labelKey: "methodology.cross_rule_7_label", textKey: "methodology.cross_rule_7_text" },
  { labelKey: "methodology.cross_rule_8_label", textKey: "methodology.cross_rule_8_text" },
  { labelKey: "methodology.cross_rule_9_label", textKey: "methodology.cross_rule_9_text" },
];

const THREAT_MODEL_ITEMS = [
  { num: "1", labelKey: "methodology.threat_1_label", textKey: "methodology.threat_1_text" },
  { num: "2", labelKey: "methodology.threat_2_label", textKey: "methodology.threat_2_text" },
  { num: "3", labelKey: "methodology.threat_3_label", textKey: "methodology.threat_3_text" },
  { num: "4", labelKey: "methodology.threat_4_label", textKey: "methodology.threat_4_text" },
];

const LIMITATION_KEYS = [
  "methodology.limitation_1",
  "methodology.limitation_2",
  "methodology.limitation_3",
  "methodology.limitation_4",
];

const TOC_ITEMS = [
  { labelKey: "methodology.toc_threat_model", id: "threat-model" },
  { labelKey: "methodology.toc_heuristics", id: "heuristics" },
  { labelKey: "methodology.toc_scoring", id: "scoring" },
  { labelKey: "methodology.toc_grades", id: "grades" },
  { labelKey: "methodology.toc_cross_heuristic", id: "cross-heuristic" },
  { labelKey: "methodology.toc_limitations", id: "limitations" },
];

export default function MethodologyPage() {
  const { t } = useTranslation();
  const [expandedGrade, setExpandedGrade] = useState<string | null>(null);

  const toggleGrade = (grade: string) => {
    setExpandedGrade((prev) => (prev === grade ? null : grade));
  };

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
          <p className="text-muted text-lg leading-relaxed max-w-2xl">
            {t("methodology.subtitle", { defaultValue: "How your Bitcoin privacy is scored. Every heuristic documented, every penalty explained. The same techniques chain surveillance firms use - applied client-side to show you the results." })}
          </p>
        </div>

        {/* Table of contents */}
        <nav className="flex flex-wrap gap-2 text-sm" aria-label="Page sections">
          {TOC_ITEMS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="px-3 py-2.5 rounded-lg bg-surface-elevated border border-card-border text-muted hover:text-foreground hover:border-bitcoin/30 transition-all"
            >
              {t(s.labelKey, { defaultValue: s.labelKey })}
            </a>
          ))}
        </nav>

        {/* Threat model */}
        <section id="threat-model" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("methodology.threat_model_heading", { defaultValue: "Threat Model" })}
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p
              className="text-muted leading-relaxed"
              dangerouslySetInnerHTML={{
                __html: t("methodology.threat_model_intro", {
                  defaultValue: 'The analysis models the capabilities of <b>chain surveillance firms</b> (Chainalysis, Elliptic, CipherTrace) and <b>KYC-linked exchanges</b>. These adversaries:',
                }),
              }}
            />
            <ul className="space-y-2 text-muted leading-relaxed">
              {THREAT_MODEL_ITEMS.map((item) => (
                <li key={item.num} className="flex gap-2">
                  <span className="text-bitcoin shrink-0">{item.num}.</span>
                  <span>
                    <span className="text-foreground">
                      {t(item.labelKey, { defaultValue: item.labelKey })}
                    </span>
                    {" - "}
                    {t(item.textKey, { defaultValue: item.textKey })}
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
            {t("methodology.heuristics_intro", { defaultValue: "The engine implements 16 heuristics that evaluate on-chain privacy - 12 at the transaction level and 4 at the address level. Each produces a score impact applied to a base score of 70." })}
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
                    {t(h.titleKey, { defaultValue: h.titleKey })}
                  </h3>
                  <span className={`text-sm font-mono shrink-0 ${getImpactColor(h.impact)}`}>
                    {h.impact}
                  </span>
                </div>
                <p className="text-muted text-base leading-relaxed">
                  {t(h.descKey, { defaultValue: h.descKey })}
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
              <p
                className="text-muted leading-relaxed"
                dangerouslySetInnerHTML={{
                  __html: t("methodology.calculation_text", {
                    defaultValue: 'Every analysis starts from a <b>base score of 70</b> - representing a typical Bitcoin transaction with no obviously good or bad characteristics. The base is above 50 because most transactions are not catastrophically bad; they carry the normal, baseline exposure of a transparent public blockchain.',
                  }),
                }}
              />
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
                        {t(g.descKey, { defaultValue: g.descKey })}
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
                            {t(g.detailKey, { defaultValue: g.detailKey })}
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
                      {t(rule.labelKey, { defaultValue: rule.labelKey })}
                    </span>
                    {" - "}
                    {t(rule.textKey, { defaultValue: rule.textKey })}
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
              {LIMITATION_KEYS.map((key, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="text-severity-medium shrink-0">&bull;</span>
                  <span>{t(key, { defaultValue: key })}</span>
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
      </div>
    </div>
  );
}
