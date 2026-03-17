"use client";

import { Suspense, lazy } from "react";
import Link from "next/link";
import { ArrowRight, Github } from "lucide-react";
import { useTranslation } from "react-i18next";

const TipJar = lazy(() =>
  import("@/components/TipJar").then((m) => ({ default: m.TipJar }))
);

export default function WelcomePage() {
  const { t } = useTranslation();

  return (
    <div className="flex-1 flex flex-col items-center px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <article className="w-full max-w-2xl space-y-14">

        {/* --- Why it exists --- */}
        <section className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("welcome.why_heading", { defaultValue: "Why This Exists" })}
          </h2>
          <div className="space-y-4 text-muted leading-relaxed">
            <p>{t("welcome.why_p1", { defaultValue: "In April 2024, OXT.me and KYCP.org went offline after the Samourai Wallet arrests. They were the only tools that let ordinary people see what chain analysis firms could infer about their transactions." })}</p>
            <p>{t("welcome.why_p2", { defaultValue: "Chainalysis, Elliptic, and Crystal kept their tools. The asymmetry became total: they could see everything about you, and you could see nothing about yourself." })}</p>
            <p className="font-medium text-foreground">{t("welcome.why_p3", { defaultValue: "am-i.exposed was built to close that gap." })}</p>
          </div>
        </section>

        {/* --- What it is --- */}
        <section className="space-y-5">
          <p className="text-xl sm:text-2xl font-semibold text-bitcoin leading-snug">
            {t("welcome.hero_tagline", { defaultValue: "They score your wallet every day. You've never seen the results." })}
          </p>
          <p className="text-muted leading-relaxed">
            {t("welcome.hero_desc", { defaultValue: "A Bitcoin privacy scanner that runs the same heuristics chain surveillance firms use. Except it runs in your browser. And it doesn't phone home." })}
          </p>
        </section>

        {/* --- What it is not --- */}
        <section className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("welcome.not_heading", { defaultValue: "What This Is Not" })}
          </h2>
          <div className="space-y-4 text-muted leading-relaxed">
            <p>{t("welcome.not_p1", { defaultValue: "This is not a company. There are no accounts, no data collection, no cookies, no analytics. There is no privacy policy because there is nothing to write a privacy policy about." })}</p>
            <p>{t("welcome.not_p2", { defaultValue: "This is just a static website. No server, no backend - plain HTML, JS, CSS, and WASM. A complex one, but still just a static site. Your addresses and transactions never leave your browser. The only network requests go to mempool.space for blockchain data - or to your own instance if you run one." })}</p>
          </div>
        </section>

        {/* --- The vision --- */}
        <section className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("welcome.vision_heading", { defaultValue: "The Vision" })}
          </h2>
          <div className="space-y-4 text-muted leading-relaxed">
            <p className="font-medium text-foreground">{t("welcome.vision_p1", { defaultValue: "Bitcoin privacy is not individual. It is collective." })}</p>
            <p>{t("welcome.vision_p2", { defaultValue: "Every time you break the round amount heuristic, you make every other transaction on the network harder to classify. Every time you stop reusing addresses, the clustering algorithms lose a link - not just on your wallet, but on every wallet that ever transacted with you. Every time you run a CoinJoin, you expand the anonymity set for everyone in the round, including people you will never meet." })}</p>
            <p>{t("welcome.vision_p3", { defaultValue: "The surveillance model depends on patterns. On habits. On the assumption that most people won't bother. Every user who bothers degrades the model for everyone being watched." })}</p>
            <p>{t("welcome.vision_p4", { defaultValue: "This tool exists so you can see exactly which patterns you're leaking. Not to shame you - to show you where the easy wins are. Most privacy improvements take thirty seconds. Use a new address. Avoid round amounts. Don't merge all your coins into one transaction." })}</p>
            <p>{t("welcome.vision_p5", { defaultValue: "The goal is not perfection. The goal is for enough people to make small, consistent improvements that the heuristics stop being reliable. That's how you break surveillance at scale - not with one perfect transaction, but with a million slightly better ones." })}</p>
          </div>
        </section>

        {/* --- The money question --- */}
        <section className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("welcome.money_heading", { defaultValue: "The Money Question" })}
          </h2>
          <div className="space-y-4 text-muted leading-relaxed">
            <p>{t("welcome.money_p1", { defaultValue: "There is no revenue model. This tool makes zero money." })}</p>
            <p>{t("welcome.money_p2", { defaultValue: "If it helps you, there's a Lightning tip jar below. That's it. No ads will ever appear here. No investor is waiting for an exit. No token launch. No \"sign up for early access.\" If this tool disappears one day, it'll be because the maintainer moved on, not because a business failed." })}</p>
            <p>{t("welcome.money_p3", { defaultValue: "Everything is open source. MIT licensed. Fork it, audit it, self-host it. The code is the product. This is just a static page. The product is free." })}</p>
          </div>
        </section>

        {/* --- Tip jar --- */}
        <section className="flex justify-center">
          <div className="w-full">
            <Suspense fallback={null}>
              <TipJar />
            </Suspense>
          </div>
        </section>

        {/* --- The catch --- */}
        <section className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("welcome.catch_heading", { defaultValue: "The Catch" })}
          </h2>
          <p className="text-muted leading-relaxed">
            {t("welcome.catch_p1", { defaultValue: "This tool cannot protect you from anything. It can only show you what is already visible to anyone running the same heuristics. If the result scares you, that's the point. Now you know what they know." })}
          </p>
        </section>

        {/* --- CTA --- */}
        <section className="flex flex-col items-center gap-4 pt-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-bitcoin text-black font-semibold text-base hover:bg-bitcoin/90 transition-colors"
          >
            {t("welcome.cta", { defaultValue: "Scan your first transaction" })}
            <ArrowRight size={18} />
          </Link>
          <a
            href="https://github.com/Copexit/am-i-exposed"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
          >
            <Github size={14} />
            {t("welcome.github_link", { defaultValue: "View source on GitHub" })}
          </a>
        </section>
      </article>
    </div>
  );
}
