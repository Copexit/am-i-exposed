"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  Shield,
  Zap,
  ArrowRightLeft,
  Layers,
  Lock,
  Coins,
  Target,
  CheckCircle2,
  AlertTriangle,
  Info,
  Route,
  XCircle,
  ArrowDown,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { WalletIcon } from "@/components/ui/WalletIcon";
import { PATHWAYS, COMBINED_PATHWAYS, type PathwayData } from "@/data/guide/pathways";
import { RECOMMENDED_WALLETS, WALLETS_TO_AVOID, WALLET_CRITERIA } from "@/data/guide/wallets";
import { MAINTENANCE_SECTIONS } from "@/data/guide/maintenance";
import { MISTAKES } from "@/data/guide/mistakes";
import { RECOVERY_STEPS, RECOVERY_TOOLS } from "@/data/guide/recovery";
import { SEVERITY_COLORS, SEVERITY_DOT } from "@/lib/severity";

const ICON_MAP: Record<string, React.ReactNode> = {
  Zap: <Zap size={14} />,
  ArrowRightLeft: <ArrowRightLeft size={14} />,
  Layers: <Layers size={14} />,
  Lock: <Lock size={14} />,
  Shield: <Shield size={14} />,
  Coins: <Coins size={14} />,
  Target: <Target size={14} />,
};

function BoolCell({ value }: { value: boolean | "partial" | "native" | "is-node" | "v1-only" | "send-only" | "stowaway" }) {
  const { t } = useTranslation();
  if (value === true) return <span className="text-severity-good">&#10003;</span>;
  if (value === false) return <span className="text-muted">&#10007;</span>;
  if (value === "is-node") return <span className="text-severity-good text-xs">{t("walletGuide.isNode", { defaultValue: "Is the node" })}</span>;
  if (value === "native") return <span className="text-severity-good text-xs">{t("walletGuide.native", { defaultValue: "Native" })}</span>;
  if (value === "v1-only") return <span className="text-severity-medium text-xs">{t("walletGuide.v1Only", { defaultValue: "v1 only" })}</span>;
  if (value === "send-only") return <span className="text-severity-medium text-xs">{t("walletGuide.sendOnly", { defaultValue: "Send only" })}</span>;
  if (value === "stowaway") return <span className="text-severity-medium text-xs">{t("walletGuide.stowaway", { defaultValue: "Stowaway" })}</span>;
  return <span className="text-severity-medium text-xs">{t("walletGuide.partial", { defaultValue: "Partial" })}</span>;
}

function TypeBadge({ type }: { type: ("desktop" | "mobile" | "hardware")[] }) {
  const { t } = useTranslation();
  const config = {
    desktop: { label: t("walletGuide.typeDesktop", { defaultValue: "Desktop" }), cls: "bg-severity-low/15 text-severity-low" },
    mobile: { label: t("walletGuide.typeMobile", { defaultValue: "Mobile" }), cls: "bg-severity-good/15 text-severity-good" },
    hardware: { label: t("walletGuide.typeHardware", { defaultValue: "Hardware" }), cls: "bg-severity-medium/15 text-severity-medium" },
  };
  return (
    <span className="inline-flex gap-1 flex-wrap justify-center">
      {type.map((tp) => {
        const c = config[tp];
        return <span key={tp} className={`text-xs px-1.5 py-0.5 rounded ${c.cls}`}>{c.label}</span>;
      })}
    </span>
  );
}

function PathwayCard({ pathway, expanded, onToggle }: {
  pathway: PathwayData;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div id={pathway.id} className="bg-surface-inset border border-card-border rounded-lg overflow-hidden scroll-mt-24">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex items-center gap-2 w-full px-4 py-3 text-left cursor-pointer hover:bg-surface-elevated/50 transition-colors"
      >
        <span className="text-bitcoin">{ICON_MAP[pathway.iconName]}</span>
        <span className="text-base font-medium text-foreground/90 flex-1">
          {t(pathway.titleKey, { defaultValue: pathway.titleDefault })}
        </span>
        <ChevronDown
          size={14}
          className={`text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 space-y-2.5">
              <p className="text-base text-muted leading-relaxed">
                {t(pathway.descKey, { defaultValue: pathway.descDefault })}
              </p>
              <div className="space-y-1.5">
                {pathway.pros.map((pro, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <CheckCircle2 size={14} className="text-severity-good shrink-0 mt-0.5" />
                    <span className="text-sm text-foreground/80">{t(pro.key, { defaultValue: pro.default })}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                {pathway.cons.map((con, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <AlertTriangle size={14} className="text-severity-medium shrink-0 mt-0.5" />
                    <span className="text-sm text-foreground/80">{t(con.key, { defaultValue: con.default })}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {pathway.tools.map((tool) => (
                  <span key={tool} className="text-xs font-mono px-2 py-0.5 rounded bg-card-bg border border-card-border text-muted">
                    {tool}
                  </span>
                ))}
              </div>
              {pathway.warnings?.map((warn, i) => (
                <div key={i} className="flex items-start gap-1.5 bg-severity-medium/10 rounded-lg px-3 py-2">
                  <Info size={14} className="text-severity-medium shrink-0 mt-0.5" />
                  <span className="text-sm text-foreground/80">{t(warn.key, { defaultValue: warn.default })}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SectionHeader({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-2xl font-bold text-foreground scroll-mt-24">
      {children}
    </h2>
  );
}

export default function GuidePage() {
  const { t } = useTranslation();
  const [expandedPathway, setExpandedPathway] = useState<string | null>(null);
  const [showCombined, setShowCombined] = useState(false);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;

    const matched = PATHWAYS.find((p) => p.id === hash);
    if (matched) setExpandedPathway(matched.id);

    if (COMBINED_PATHWAYS.some((c) => c.id === hash)) setShowCombined(true);

    const timer = setTimeout(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-4xl space-y-10">
        {/* Back nav */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft size={16} />
          {t("guide.back", { defaultValue: "Back to scanner" })}
        </Link>

        {/* Title */}
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-3">
            {t("guide.title", { defaultValue: "Bitcoin Privacy Guide" })}
          </h1>
          <p className="text-muted text-lg leading-relaxed max-w-2xl">
            {t("guide.subtitle", { defaultValue: "Techniques, tools, and best practices for maintaining Bitcoin privacy. All the educational content from am-i.exposed in one reference." })}
          </p>
        </div>

        {/* TOC */}
        <nav className="bg-surface-inset rounded-lg px-5 py-4 space-y-1.5" aria-label="Table of contents">
          <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
            {t("guide.tocTitle", { defaultValue: "Sections" })}
          </p>
          {[
            { id: "privacy-techniques", label: t("guide.toc.techniques", { defaultValue: "Privacy techniques" }) },
            { id: "combined-strategies", label: t("guide.toc.combined", { defaultValue: "Combined strategies" }) },
            { id: "wallet-comparison", label: t("guide.toc.wallets", { defaultValue: "Wallet comparison" }) },
            { id: "common-mistakes", label: t("guide.toc.mistakes", { defaultValue: "Common mistakes" }) },
            { id: "recovery-playbook", label: t("guide.toc.recovery", { defaultValue: "Recovery playbook" }) },
            { id: "maintaining-privacy", label: t("guide.toc.maintaining", { defaultValue: "Maintaining privacy" }) },
          ].map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="block text-base text-bitcoin/80 hover:text-bitcoin transition-colors"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* ── Section 1: Privacy Techniques ─────────────────────────── */}
        <section className="space-y-4">
          <SectionHeader id="privacy-techniques">
            <Shield size={20} className="inline mr-2 text-bitcoin" />
            {t("guide.techniquesTitle", { defaultValue: "Privacy techniques" })}
          </SectionHeader>
          <p className="text-base text-muted leading-relaxed">
            {t("pathways.intro", {
              defaultValue: "On-chain privacy tools like CoinJoin are just one layer. The strongest privacy comes from combining multiple techniques across different networks.",
            })}
          </p>

          {/* On-chain */}
          {PATHWAYS.some((p) => p.category === "on-chain") && (
            <p className="text-sm font-medium text-foreground/70 uppercase tracking-wide pt-1">
              {t("pathways.onchainTitle", { defaultValue: "On-chain spending techniques" })}
            </p>
          )}
          {PATHWAYS.filter((p) => p.category === "on-chain").map((pathway) => (
            <PathwayCard
              key={pathway.id}
              pathway={pathway}
              expanded={expandedPathway === pathway.id}
              onToggle={() => setExpandedPathway(expandedPathway === pathway.id ? null : pathway.id)}
            />
          ))}

          {/* Off-chain */}
          <p className="text-sm font-medium text-foreground/70 uppercase tracking-wide pt-2">
            {t("pathways.offchainTitle", { defaultValue: "Off-chain and cross-chain pathways" })}
          </p>
          {PATHWAYS.filter((p) => p.category === "off-chain").map((pathway) => (
            <PathwayCard
              key={pathway.id}
              pathway={pathway}
              expanded={expandedPathway === pathway.id}
              onToggle={() => setExpandedPathway(expandedPathway === pathway.id ? null : pathway.id)}
            />
          ))}
        </section>

        {/* ── Section 2: Combined Strategies ────────────────────────── */}
        <section className="space-y-4">
          <SectionHeader id="combined-strategies">
            <Route size={20} className="inline mr-2 text-bitcoin" />
            {t("guide.combinedTitle", { defaultValue: "Combined strategies" })}
          </SectionHeader>
          <button
            onClick={() => setShowCombined(!showCombined)}
            aria-expanded={showCombined}
            className="flex items-center gap-1.5 text-sm font-medium text-foreground/90 cursor-pointer hover:text-foreground transition-colors w-full text-left"
          >
            {t("pathways.combined.title", { defaultValue: "Combined pathways (strongest privacy)" })}
            <ChevronDown
              size={14}
              className={`text-muted transition-transform ml-auto ${showCombined ? "rotate-180" : ""}`}
            />
          </button>
          <AnimatePresence>
            {showCombined && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="space-y-3">
                  <p className="text-sm text-muted leading-relaxed">
                    {t("pathways.combined.intro", {
                      defaultValue: "Think beyond single-tool solutions. The most effective privacy strategies combine multiple techniques across different layers.",
                    })}
                  </p>
                  {COMBINED_PATHWAYS.map((combo) => (
                    <div
                      key={combo.id}
                      id={combo.id}
                      className="bg-surface-elevated/50 border border-card-border rounded-lg px-4 py-3 space-y-1.5 scroll-mt-24"
                    >
                      <p className="text-sm font-medium text-bitcoin">
                        {t(combo.titleKey, { defaultValue: combo.titleDefault })}
                      </p>
                      <p className="text-sm text-foreground/80 leading-relaxed">
                        {t(combo.stepsKey, { defaultValue: combo.stepsDefault })}
                      </p>
                      <p className="text-xs text-muted leading-relaxed">
                        {t(combo.strengthKey, { defaultValue: combo.strengthDefault })}
                      </p>
                    </div>
                  ))}
                  <div className="flex items-start gap-1.5 bg-severity-medium/10 rounded-lg px-3 py-2 mt-1">
                    <AlertTriangle size={14} className="text-severity-medium shrink-0 mt-0.5" />
                    <p className="text-xs text-foreground/80 leading-relaxed">
                      {t("pathways.jurisdictionNote", {
                        defaultValue: "Privacy tool availability and legality vary by jurisdiction. Research your local regulations regarding CoinJoin, atomic swaps, and privacy coins before using these techniques. Some exchanges may flag or restrict accounts that interact with known privacy tools.",
                      })}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* ── Section 3: Wallet Comparison ──────────────────────────── */}
        <section className="space-y-4">
          <SectionHeader id="wallet-comparison">
            <Shield size={20} className="inline mr-2 text-bitcoin" />
            {t("guide.walletsTitle", { defaultValue: "Wallet comparison" })}
          </SectionHeader>

          {/* Recommended wallets table */}
          <div className="bg-surface-inset rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-card-border">
              <h3 className="text-sm font-medium text-foreground/90">
                {t("walletGuide.recommendedTitle", { defaultValue: "Recommended wallets - low on-chain footprint" })}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border text-xs text-muted">
                    <th className="text-left px-4 py-2 font-medium">{t("walletGuide.colWallet", { defaultValue: "Wallet" })}</th>
                    <th className="text-center px-2 py-2 font-medium">{t("walletGuide.colType", { defaultValue: "Type" })}</th>
                    <th className="text-center px-2 py-2 font-medium whitespace-nowrap">nSeq</th>
                    <th className="text-center px-2 py-2 font-medium whitespace-nowrap">{t("walletGuide.colAntiFeeSniping", { defaultValue: "Anti-snip" })}</th>
                    <th className="text-center px-2 py-2 font-medium">CoinJoin</th>
                    <th className="text-center px-2 py-2 font-medium whitespace-nowrap">{t("walletGuide.colPayJoin", { defaultValue: "PayJoin" })}</th>
                    <th className="text-center px-2 py-2 font-medium whitespace-nowrap" title="BIP47 / Paynym">{t("walletGuide.colBip47", { defaultValue: "BIP47" })}</th>
                    <th className="text-center px-2 py-2 font-medium whitespace-nowrap" title="Silent Payments (BIP352)">{t("walletGuide.colSilentPay", { defaultValue: "SP" })}</th>
                    <th className="text-center px-2 py-2 font-medium">{t("walletGuide.colOwnNode", { defaultValue: "Own Node" })}</th>
                    <th className="text-center px-2 py-2 font-medium">Tor</th>
                  </tr>
                </thead>
                <tbody>
                  {RECOMMENDED_WALLETS.map((w) => (
                    <tr key={w.name} className="border-b border-card-border/50 hover:bg-surface-elevated/50 transition-colors">
                      <td className="px-4 py-2">
                        <a
                          href={w.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-bitcoin hover:text-bitcoin-hover transition-colors"
                        >
                          <WalletIcon walletName={w.name} size="md" />
                          {w.name}
                          <ExternalLink size={12} />
                        </a>
                      </td>
                      <td className="text-center px-2 py-2"><TypeBadge type={w.type} /></td>
                      <td className="text-center px-2 py-2"><BoolCell value={w.nSequence === "good"} /></td>
                      <td className="text-center px-2 py-2"><BoolCell value={w.antiFeeSniping} /></td>
                      <td className="text-center px-2 py-2"><BoolCell value={w.coinJoin} /></td>
                      <td className="text-center px-2 py-2"><BoolCell value={w.payJoin} /></td>
                      <td className="text-center px-2 py-2"><BoolCell value={w.bip47} /></td>
                      <td className="text-center px-2 py-2"><BoolCell value={w.silentPayments} /></td>
                      <td className="text-center px-2 py-2"><BoolCell value={w.ownNode} /></td>
                      <td className="text-center px-2 py-2"><BoolCell value={w.tor} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Wallets to avoid */}
          <div className="bg-severity-critical/5 border border-severity-critical/20 rounded-lg px-4 py-3">
            <h3 className="text-sm font-medium text-severity-critical mb-2">
              {t("walletGuide.avoidTitle", { defaultValue: "Wallets to avoid for privacy" })}
            </h3>
            <ul className="space-y-1.5">
              {WALLETS_TO_AVOID.map((w) => (
                <li key={w.name} className="flex items-start gap-2 text-sm text-muted">
                  <WalletIcon walletName={w.name} size="sm" className="mt-0.5" />
                  <ShieldX size={14} className="text-severity-critical shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-foreground/90">{w.name}</strong>
                    {" - "}
                    {t(w.reasonKey, { defaultValue: w.reasonDefault })}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Good vs bad criteria */}
          <div className="bg-surface-inset rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-card-border">
              <h3 className="text-sm font-medium text-foreground/90">
                {t("walletGuide.criteriaTitle", { defaultValue: "What makes a wallet good or bad for privacy" })}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border text-xs text-muted">
                    <th className="text-left px-4 py-2 font-medium">{t("walletGuide.colCriteria", { defaultValue: "Criteria" })}</th>
                    <th className="text-left px-3 py-2 font-medium text-severity-good">{t("walletGuide.colGood", { defaultValue: "Good" })}</th>
                    <th className="text-left px-3 py-2 font-medium text-severity-critical">{t("walletGuide.colBad", { defaultValue: "Bad" })}</th>
                  </tr>
                </thead>
                <tbody>
                  {WALLET_CRITERIA.map((row) => (
                    <tr key={row.criteria} className="border-b border-card-border/50">
                      <td className="px-4 py-2 font-mono text-xs text-foreground/90">
                        {t(row.criteriaKey, { defaultValue: row.criteria })}
                      </td>
                      <td className="px-3 py-2 text-xs text-severity-good">
                        {t(row.goodKey, { defaultValue: row.good })}
                      </td>
                      <td className="px-3 py-2 text-xs text-severity-critical">
                        {t(row.badKey, { defaultValue: row.bad })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Fingerprint contradiction */}
          <div className="bg-surface-inset rounded-lg px-4 py-3 border-l-2 border-l-bitcoin/50">
            <h3 className="text-sm font-medium text-foreground/90 mb-2">
              {t("walletGuide.contradictionTitle", { defaultValue: "Why recommend wallets that have fingerprints?" })}
            </h3>
            <div className="text-sm text-muted space-y-2 leading-relaxed">
              <p className="text-sm">{t("walletGuide.contradictionP1", { defaultValue: "Every wallet leaves a fingerprint - that is unavoidable. The goal is not to be invisible, but to be indistinguishable from millions of other users." })}</p>
              <p className="text-sm">{t("walletGuide.contradictionP2", { defaultValue: "A Bitcoin Core fingerprint is shared by millions of transactions. Knowing someone uses Bitcoin Core reveals almost nothing useful. An Exodus fingerprint, on the other hand, reveals poor privacy practices (no coin control, no Tor, centralized servers) and belongs to a much smaller set." })}</p>
              <p className="text-sm text-foreground/80 font-medium">{t("walletGuide.contradictionP3", { defaultValue: "Choose wallets where the fingerprint says \"one of millions\" rather than \"one of a few with poor habits.\"" })}</p>
            </div>
          </div>
        </section>

        {/* ── Section 4: Common Mistakes ────────────────────────────── */}
        <section className="space-y-4">
          <SectionHeader id="common-mistakes">
            <XCircle size={20} className="inline mr-2 text-severity-high" />
            {t("guide.mistakesTitle", { defaultValue: "Common mistakes to avoid" })}
          </SectionHeader>
          <div className="space-y-2">
            {MISTAKES.map((mistake, i) => (
              <div key={i} className="bg-severity-high/5 border border-severity-high/15 rounded-lg px-4 py-3">
                <div className="flex items-start gap-2">
                  <XCircle size={16} className="text-severity-high shrink-0 mt-0.5" />
                  <div>
                    <p className="text-base font-medium text-foreground/90">
                      {t(mistake.titleKey, { defaultValue: mistake.titleDefault })}
                    </p>
                    <p className="text-sm text-muted mt-1 leading-relaxed">
                      {t(mistake.descKey, { defaultValue: mistake.descDefault })}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Section 5: Recovery Playbook ──────────────────────────── */}
        <section className="space-y-4">
          <SectionHeader id="recovery-playbook">
            <CheckCircle2 size={20} className="inline mr-2 text-severity-critical" />
            {t("guide.recoveryTitle", { defaultValue: "Recovery playbook" })}
          </SectionHeader>
          <p className="text-base text-muted leading-relaxed">
            {t("recoveryFlow.intro", { defaultValue: "Follow these steps to improve your privacy score from Critical/F to Healthy/A:" })}
          </p>
          <div className="space-y-1">
            {RECOVERY_STEPS.map((step, i) => (
              <div key={i}>
                <div className={`rounded-lg border px-4 py-3 ${SEVERITY_COLORS[step.severity]}`}>
                  <div className="flex items-start gap-3">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold text-white ${SEVERITY_DOT[step.severity]} shrink-0`}>
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-base font-medium text-foreground/90">
                        {t(step.titleKey, { defaultValue: step.titleDefault })}
                      </p>
                      <p className="text-sm text-muted mt-1 leading-relaxed">
                        {t(step.descKey, { defaultValue: step.descDefault })}
                      </p>
                    </div>
                  </div>
                </div>
                {i < RECOVERY_STEPS.length - 1 && (
                  <div className="flex justify-center py-0.5">
                    <ArrowDown size={14} className="text-muted/50" />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            {RECOVERY_TOOLS.map((tool) => (
              <a
                key={tool.name}
                href={tool.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-bitcoin hover:text-bitcoin-hover transition-colors px-3 py-1.5 rounded-lg border border-bitcoin/20 hover:border-bitcoin/40 bg-bitcoin/5"
              >
                <WalletIcon walletName={tool.name} size="sm" />
                {tool.name}
                <ExternalLink size={12} />
              </a>
            ))}
          </div>
        </section>

        {/* ── Section 6: Maintaining Privacy ────────────────────────── */}
        <section className="space-y-4">
          <SectionHeader id="maintaining-privacy">
            <ShieldCheck size={20} className="inline mr-2 text-severity-good" />
            {t("guide.maintenanceTitle", { defaultValue: "Maintaining your privacy" })}
          </SectionHeader>
          <p className="text-base text-muted leading-relaxed">
            {t("maintenance.intro", {
              defaultValue: "Good privacy is not a one-time achievement - it requires ongoing discipline. These practices help maintain the privacy gains detected in this analysis.",
            })}
          </p>
          {MAINTENANCE_SECTIONS.map((section) => (
            <div
              key={section.titleKey}
              className="bg-severity-good/5 border border-severity-good/15 rounded-lg px-4 py-3"
            >
              <p className="text-base font-medium text-foreground/90 mb-1.5">
                {t(section.titleKey, { defaultValue: section.titleDefault })}
              </p>
              <ul className="space-y-1">
                {section.tipsKeys.map((tip) => (
                  <li key={tip.key} className="flex items-start gap-2 text-sm text-muted leading-relaxed">
                    <span className="text-severity-good shrink-0 mt-0.5">-</span>
                    {t(tip.key, { defaultValue: tip.default })}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {/* Back to top */}
        <div className="text-center pt-6 pb-4">
          <a
            href="#"
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            {t("guide.backToTop", { defaultValue: "Back to top" })} &uarr;
          </a>
        </div>
      </div>
    </div>
  );
}
