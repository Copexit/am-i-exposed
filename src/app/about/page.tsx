"use client";

import Link from "next/link";
import { ArrowLeft, Shield, Eye, Code, Globe, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

const PRINCIPLES = [
  { icon: Shield, titleKey: "about.principle_client_title", descKey: "about.principle_client_desc" },
  { icon: Eye, titleKey: "about.principle_no_tracking_title", descKey: "about.principle_no_tracking_desc" },
  { icon: Code, titleKey: "about.principle_open_source_title", descKey: "about.principle_open_source_desc" },
  { icon: Globe, titleKey: "about.principle_free_title", descKey: "about.principle_free_desc" },
  { icon: Zap, titleKey: "about.principle_v4v_title", descKey: "about.principle_v4v_desc" },
];

const DEFAULTS: Record<string, string> = {
  "about.principle_client_title": "100% Client-Side",
  "about.principle_client_desc": "All analysis runs in your browser. No server processes your data. No backend stores your queries.",
  "about.principle_no_tracking_title": "No Tracking",
  "about.principle_no_tracking_desc": "No analytics, no cookies, no fingerprinting. What you scan is never visible to anyone.",
  "about.principle_open_source_title": "Open Source",
  "about.principle_open_source_desc": "Every line of code is auditable. MIT licensed. Fork it, self-host it, improve it.",
  "about.principle_free_title": "Free Forever",
  "about.principle_free_desc": "No paywalls, no premium tiers, no token. Bitcoin privacy tools should be accessible to everyone.",
  "about.principle_v4v_title": "Value for Value",
  "about.principle_v4v_desc": "If it provides value, send value back via Lightning. No pressure, no guilt, no accounts.",
};

export default function AboutPage() {
  const { t } = useTranslation();

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-4xl space-y-10">
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
          <p className="text-muted text-lg leading-relaxed max-w-2xl">
            {t("about.subtitle", { defaultValue: "The Bitcoin privacy tools the community relied on are gone. This is the replacement." })}
          </p>
        </div>

        {/* The story */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("about.story_heading", { defaultValue: "The Gap" })}
          </h2>
          <div className="space-y-4 text-muted leading-relaxed">
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

        {/* What it does */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("about.what_heading", { defaultValue: "What It Does" })}
          </h2>
          <div className="space-y-4 text-muted leading-relaxed">
            <p>
              {t("about.what_p1", { defaultValue: "Paste any Bitcoin address or transaction ID. The tool runs 16 heuristics against it - the same techniques chain analysis firms use - and shows you exactly what they can infer." })}
            </p>
            <p>
              {t("about.what_p2", { defaultValue: "You get a privacy score from 0 to 100, a letter grade, and specific findings with actionable recommendations. Not just 'your privacy is bad' but 'here is why, and here is what to do about it.'" })}
            </p>
          </div>
        </section>

        {/* Design principles */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("about.principles_heading", { defaultValue: "Design Principles" })}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 [&>*:last-child:nth-child(odd)]:sm:col-span-2">
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

        {/* Built by */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("about.built_heading", { defaultValue: "Built By" })}
          </h2>
          <p className="text-muted leading-relaxed">
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
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
