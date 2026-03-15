"use client";

import { Suspense, lazy } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Shield,
  Eye,
  Code,
  Globe,
  Zap,
  Search,
  GitFork,
  Database,
  Cpu,
  Wallet,
  FileCheck,
  BarChart3,
  Languages,
  Server,
  BookOpen,
  HardDrive,
} from "lucide-react";
import { useTranslation } from "react-i18next";

const TipJar = lazy(() =>
  import("@/components/TipJar").then((m) => ({ default: m.TipJar }))
);

const PRINCIPLES = [
  { icon: Shield, titleKey: "about.principle_client_title", descKey: "about.principle_client_desc" },
  { icon: Eye, titleKey: "about.principle_no_tracking_title", descKey: "about.principle_no_tracking_desc" },
  { icon: Code, titleKey: "about.principle_open_source_title", descKey: "about.principle_open_source_desc" },
  { icon: Globe, titleKey: "about.principle_free_title", descKey: "about.principle_free_desc" },
  { icon: Zap, titleKey: "about.principle_v4v_title", descKey: "about.principle_v4v_desc" },
];

const DEFAULTS: Record<string, string> = {
  "about.principle_client_title": "100% Client-Side",
  "about.principle_client_desc": "All analysis runs in your browser. No server processes or stores your data.",
  "about.principle_no_tracking_title": "No Tracking",
  "about.principle_no_tracking_desc": "No analytics, no cookies, no fingerprinting. What you scan is never sent to any analytics or tracking service.",
  "about.principle_open_source_title": "Open Source",
  "about.principle_open_source_desc": "Every line of code is auditable. MIT licensed. Fork it, self-host it, improve it.",
  "about.principle_free_title": "Free Forever",
  "about.principle_free_desc": "No paywalls, no premium tiers, no token. Bitcoin privacy tools should be accessible to everyone.",
  "about.principle_v4v_title": "Value for Value",
  "about.principle_v4v_desc": "If it provides value, send value back via Lightning. No pressure, no guilt, no accounts.",
};

const STATS = [
  { value: "31", label: "Heuristics" },
  { value: "14", label: "Chain modules" },
  { value: "364", label: "Known entities" },
  { value: "30M+", label: "Addresses indexed" },
  { value: "844+", label: "Tests" },
  { value: "5", label: "Languages" },
];

const CAPABILITIES = [
  {
    icon: Search,
    title: "31 Privacy Heuristics",
    desc: "Round amounts, change detection, CIOH, CoinJoin patterns (Whirlpool, WabiSabi, JoinMarket), wallet fingerprinting, script analysis, timing, and more.",
  },
  {
    icon: GitFork,
    title: "Multi-Hop Chain Tracing",
    desc: "Backward and forward transaction tracing, entity proximity detection, taint analysis, UTXO clustering, peel chain tracing, and temporal pattern analysis.",
  },
  {
    icon: Database,
    title: "Entity Detection",
    desc: "364 known entities across 30M+ addresses - exchanges, darknet markets, mixers, gambling, mining pools, scams, and payment services. OFAC-list coverage included.",
  },
  {
    icon: Cpu,
    title: "Boltzmann Entropy (WASM)",
    desc: "Full link probability matrix computed on-device via Rust/WebAssembly. Real entropy calculation, not estimation - the same math OXT.me used, running locally using all threads, with turbo paths for JoinMarket and more.",
  },
  {
    icon: Wallet,
    title: "Wallet Audit",
    desc: "Paste an xpub or output descriptor. BIP44/49/84/86 derivation. Aggregate privacy assessment across all derived addresses - reuse, UTXO hygiene, spending patterns.",
  },
  {
    icon: FileCheck,
    title: "PSBT Pre-Broadcast Check",
    desc: "Analyze an unsigned transaction before signing. Catch round amounts, script mismatches, and fingerprinting issues while they can still be fixed.",
  },
  {
    icon: BarChart3,
    title: "Interactive Visualizations",
    desc: "Transaction flow diagrams, Boltzmann heatmaps, interactive graph explorer, taint path diagrams, cluster timelines, CoinJoin structure breakdowns, and more.",
  },
  {
    icon: Languages,
    title: "5 Languages",
    desc: "Full interface translation in English, Spanish, Portuguese, German, and French. Community contributions welcome.",
  },
  {
    icon: HardDrive,
    title: "Smart Local Cache",
    desc: "Confirmed transactions, outspends, and analysis results are cached in IndexedDB across sessions. Repeat scans are instant, API requests are minimized, and fewer queries leave your browser.",
  },
  {
    icon: Server,
    title: "Self-Hostable",
    desc: "Available as an Umbrel app connecting to your own Bitcoin node. Or point it at any custom mempool.space instance for zero third-party exposure.",
  },
];

export default function AboutPage() {
  const { t } = useTranslation();

  return (
    <div className="flex-1 flex flex-col items-center px-4 sm:px-6 lg:px-8 xl:px-10 py-8">
      <div className="w-full max-w-7xl space-y-10">
        {/* Back nav */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors py-2 -my-2"
        >
          <ArrowLeft size={16} />
          {t("about.back", { defaultValue: "Back to scanner" })}
        </Link>

        {/* Title */}
        <div className="space-y-3">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            {t("about.title", { defaultValue: "Why This Exists" })}
          </h1>
          <p className="text-muted text-lg leading-relaxed max-w-3xl">
            {t("about.subtitle", { defaultValue: "The Bitcoin privacy tools the community relied on are gone. This is the replacement." })}
          </p>
        </div>

        {/* The story */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("about.story_heading", { defaultValue: "The Gap" })}
          </h2>
          <div className="space-y-4 text-muted leading-relaxed max-w-4xl">
            <p>
              {t("about.story_p1", { defaultValue: "In April 2024, OXT.me and KYCP.org went offline following the arrest of the Samourai Wallet developers. OXT was the gold standard for Boltzmann entropy analysis. KYCP made CoinJoin privacy assessment accessible to ordinary users. Both are gone." })}
            </p>
            <p>
              {t("about.story_p2", { defaultValue: "Chain surveillance firms like Chainalysis, Elliptic, and Crystal still have their tools. They analyze every transaction on the Bitcoin blockchain. They cluster addresses, trace fund flows, and flag wallets." })}
            </p>
            <p>
              {t("about.story_p3", { defaultValue: "But as of that moment, ordinary Bitcoin users had no way to see what these firms could infer about their own transactions. The asymmetry was total: they could see everything about you, and you could see nothing about yourself." })}
            </p>
            <p className="font-medium text-foreground">
              {t("about.story_p4", { defaultValue: "am-i.exposed was built to close that gap." })}
            </p>
          </div>
        </section>

        {/* By the numbers */}
        <section>
          <div className="flex flex-wrap gap-3">
            {STATS.map((s) => (
              <div
                key={s.label}
                className="flex items-baseline gap-2 rounded-lg border border-card-border bg-surface-elevated/50 px-4 py-2.5"
              >
                <span className="text-xl font-bold text-bitcoin">{s.value}</span>
                <span className="text-sm text-muted">{s.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* What it does */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("about.what_heading", { defaultValue: "What It Does" })}
          </h2>
          <p className="text-muted leading-relaxed max-w-4xl">
            {t("about.what_intro", { defaultValue: "Paste any Bitcoin address, transaction ID, xpub/descriptor, or unsigned PSBT. The tool runs the same techniques chain analysis firms use and shows you exactly what they can infer - with a privacy score from 0 to 100, detailed findings, and actionable recommendations." })}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <div
                key={c.title}
                className="rounded-xl border border-card-border bg-surface-elevated/50 p-5 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <c.icon size={18} className="text-bitcoin shrink-0" />
                  <h3 className="font-medium text-foreground">{c.title}</h3>
                </div>
                <p className="text-sm text-muted leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Design principles */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("about.principles_heading", { defaultValue: "Design Principles" })}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>*:last-child:nth-child(3n+1)]:lg:col-span-3 [&>*:last-child:nth-child(odd)]:sm:max-lg:col-span-2">
            {PRINCIPLES.map((p) => (
              <div
                key={p.titleKey}
                className="rounded-xl border border-card-border bg-surface-elevated/50 p-5 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <p.icon size={18} className="text-bitcoin" />
                  <h3 className="font-medium text-foreground">
                    {t(p.titleKey, { defaultValue: DEFAULTS[p.titleKey] })}
                  </h3>
                </div>
                <p className="text-sm text-muted leading-relaxed">
                  {t(p.descKey, { defaultValue: DEFAULTS[p.descKey] })}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Tip jar */}
        <section className="flex justify-center">
          <div className="w-full max-w-xl">
            <Suspense fallback={null}>
              <TipJar />
            </Suspense>
          </div>
        </section>

        {/* Built by */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("about.built_heading", { defaultValue: "Built By" })}
          </h2>
          <p className="text-muted leading-relaxed max-w-4xl">
            {t("about.built_p1", { defaultValue: "am-i.exposed is built and maintained by Copexit and Arkad (@multicripto). Privacy is a right, not a feature. This project has no VC funding, no token, and no business model beyond Value for Value." })}
          </p>
        </section>

        {/* Get involved */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("about.contribute_heading", { defaultValue: "Get Involved" })}
          </h2>
          <div className="space-y-3 text-muted leading-relaxed">
            <p>
              {t("about.contribute_p1", { defaultValue: "This is an open-source project and contributions are welcome. Whether it's fixing a bug, improving a heuristic, adding a translation, or just starring the repo - every bit helps." })}
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="https://github.com/Copexit/am-i-exposed"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-surface-elevated border border-card-border text-foreground hover:border-bitcoin/30 transition-all"
              >
                <Code size={16} />
                {t("about.github_link", { defaultValue: "GitHub Repository" })}
              </a>
              <Link
                href="/methodology"
                className="inline-flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-surface-elevated border border-card-border text-foreground hover:border-bitcoin/30 transition-all"
              >
                <Shield size={16} />
                {t("about.methodology_link", { defaultValue: "Read the Methodology" })}
              </Link>
              <Link
                href="/guide"
                className="inline-flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-surface-elevated border border-card-border text-foreground hover:border-bitcoin/30 transition-all"
              >
                <BookOpen size={16} />
                {t("about.guide_link", { defaultValue: "Privacy Guide" })}
              </Link>
            </div>
          </div>
        </section>

        {/* CTA */}
        <div className="text-center space-y-2">
          <p className="text-sm text-muted">
            {t("about.cta", { defaultValue: "Ready to check your privacy? Scan a transaction or address to see what chain analysis can infer." })}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/methodology"
              className="text-sm px-4 py-2.5 rounded-lg bg-surface-elevated border border-card-border text-foreground hover:border-bitcoin/30 transition-all"
            >
              {t("common.methodology", { defaultValue: "Methodology" })}
            </Link>
            <Link
              href="/"
              className="text-sm px-4 py-2.5 rounded-lg bg-bitcoin text-background font-semibold hover:bg-bitcoin-hover transition-all"
            >
              {t("about.scanNow", { defaultValue: "Scan now" })}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
