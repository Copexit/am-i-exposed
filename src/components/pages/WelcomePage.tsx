"use client";

import { Suspense, lazy } from "react";
import Link from "next/link";
import { ArrowRight, Github, Server } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { usePathname } from "next/navigation";
import { isV2Path } from "@/lib/v2/paths";
import { uiHref } from "@/components/v2/pages/uiHref";

const TipJar = lazy(() =>
  import("@/components/TipJar").then((m) => ({ default: m.TipJar }))
);

export function WelcomePage() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const href = (h: string) => uiHref(h, pathname);

  return (
    <div className={isV2Path(pathname) ? "flex flex-col" : "flex-1 flex flex-col items-center px-4 sm:px-6 lg:px-8 py-12 sm:py-16"}>
      <article className="w-full max-w-2xl space-y-14">

        {/* --- The Problem --- */}
        <section className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("welcome.problem_heading", { defaultValue: "The Problem" })}
          </h2>
          <div className="space-y-4 text-muted leading-relaxed">
            <p>{t("welcome.problem_p1", { defaultValue: "There is a widespread belief that Bitcoin is private by default. That buying without KYC is enough." })}</p>
            <p className="font-medium text-foreground">{t("welcome.problem_p2", { defaultValue: "It is not." })}</p>
            <p>{t("welcome.problem_p3", { defaultValue: "Every transaction with another person leaks information. Not all at once, not obviously - but it accumulates. Over time, anyone you have transacted with can reconstruct fragments of your economic activity if your UTXOs have not been managed carefully. Not just chain analysis firms watching from the outside - also the person you paid last month, or the merchant who sold you something six months ago." })}</p>
            <p>{t("welcome.problem_p4", { defaultValue: "Nobody would want a stranger to know how much money they have or where it comes from. But there is enormous confusion about how Bitcoin transactions actually work, and that confusion has a cost." })}</p>
            <p>{t("welcome.problem_p5", { defaultValue: "In April 2024, OXT.me and KYCP.org went offline after the Samourai Wallet arrests. They were the only tools that let ordinary people see what chain analysis firms could infer about their transactions." })}</p>
            <p>{t("welcome.problem_p6", { defaultValue: "Chainalysis, Elliptic, and Crystal kept operating as usual. The asymmetry became absolute: they kept analyzing with their tools, and users were left with no way to see what those analyses said about them." })}</p>
            <p className="font-medium text-foreground">{t("welcome.problem_p7", { defaultValue: "am-i.exposed was built to close that gap." })}</p>
          </div>
        </section>

        {/* --- Hero tagline --- */}
        <section className="space-y-5">
          <p className="text-xl sm:text-2xl font-semibold text-bitcoin leading-snug">
            {t("welcome.hero_tagline", { defaultValue: "They score your wallet every day. You've never seen the results." })}
          </p>
          <p className="text-muted leading-relaxed">
            {t("welcome.hero_desc", { defaultValue: "A Bitcoin privacy scanner that runs the same heuristics blockchain surveillance firms use. Except it runs in your browser. And it does not phone home." })}
          </p>
        </section>

        {/* --- What this is not --- */}
        <section className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("welcome.not_heading", { defaultValue: "What This Is Not" })}
          </h2>
          <div className="space-y-4 text-muted leading-relaxed">
            <p>{t("welcome.not_p1", { defaultValue: "This is not a company. There are no accounts, no data collection, no cookies, no analytics. There is no privacy policy because there is nothing to write a privacy policy about." })}</p>
            <p>
              <Trans
                i18nKey="welcome.not_p2"
                defaults="This is a static website. No server, no backend - HTML, JS, CSS, and WASM. All analysis runs locally in your browser. Addresses and transactions are sent only to the mempool.space API for blockchain data - or to <guide>your own instance</guide> if you run a node. No results, scores, or findings are ever transmitted anywhere."
                components={{ guide: <Link href={href("/setup-guide/")} className="text-bitcoin hover:underline" /> }}
              />
            </p>
            <p>{t("welcome.not_p3", { defaultValue: "Data collection is not avoided as a policy - it is architecturally impossible. There is no server to send data to. The code is auditable. The entire application can be downloaded and run offline." })}</p>
          </div>
        </section>

        {/* --- The Blind Spot --- */}
        <section className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("welcome.blindspot_heading", { defaultValue: "The Blind Spot" })}
          </h2>
          <div className="space-y-4 text-muted leading-relaxed">
            <p>{t("welcome.blindspot_p1", { defaultValue: "There is something Chainalysis, Elliptic, and Crystal will not tell you: their analyses are assumptions. Their heuristics are based on closed-source code that nobody can independently audit or verify. This is not forensic science - it is applied statistics with error margins." })}</p>
            <p>{t("welcome.blindspot_p2", { defaultValue: "When a surveillance firm labels an address as \"probably\" linked to another, that probability comes from an opaque model. No independent validation. No peer review. No published error rates." })}</p>
            <p>{t("welcome.blindspot_p3", { defaultValue: "What is true: the more ambiguous a transaction is, the less reliable any heuristic becomes. And ambiguity is something every Bitcoin user can create." })}</p>
          </div>
        </section>

        {/* --- Collective Defense --- */}
        <section className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("welcome.collective_heading", { defaultValue: "Collective Defense" })}
          </h2>
          <div className="space-y-4 text-muted leading-relaxed">
            <p className="font-medium text-foreground">{t("welcome.collective_p1", { defaultValue: "Bitcoin privacy is not individual. It is collective." })}</p>
            <p>{t("welcome.collective_p2", { defaultValue: "Every time you avoid a round amount, you make every other transaction on the network harder to classify. Every time you stop reusing addresses, the clustering algorithms lose a link - not just on your wallet, but on every wallet that ever transacted with you. Every time you run a CoinJoin, the anonymity set grows for everyone in the round, including people you will never meet." })}</p>
            <p>{t("welcome.collective_p3", { defaultValue: "The surveillance model feeds on patterns. On habits. On the assumption that most people will not bother. Every person who bothers weakens it for everyone being watched." })}</p>
            <p>{t("welcome.collective_p4", { defaultValue: "This tool exists so you can see which patterns you are leaving exposed. Not to shame you - to show you where the easy wins are. Changing a habit takes thirty seconds. Use a new address. Avoid round amounts. Do not merge all your coins into one transaction." })}</p>
            <p>{t("welcome.collective_p5", { defaultValue: "There is no single solution that defeats blockchain analysis on its own. But every ambiguous transaction weakens the assumptions the models rely on. Every user who improves their habits erodes the reliability of the surveillance model - not just for themselves, but for every participant on the network. The goal is not perfection. The goal is for enough people to make small, consistent improvements that the heuristics stop being reliable." })}</p>
          </div>
        </section>

        {/* --- No business model --- */}
        <section className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("welcome.money_heading", { defaultValue: "No Business Model" })}
          </h2>
          <div className="space-y-4 text-muted leading-relaxed">
            <p>{t("welcome.money_p1", { defaultValue: "There is no business model. This tool makes zero money." })}</p>
            <p>{t("welcome.money_p2", { defaultValue: "If it helps, there is a Lightning tip jar below. Nothing more. No ads will ever appear here. No investor is waiting for an exit. No token. No \"sign up for early access.\" If this tool disappears one day, it will be because the maintainer moved on - not because a business failed." })}</p>
            <p>{t("welcome.money_p3", { defaultValue: "All the code is open. MIT licensed. Fork it, audit it, run your own copy." })}</p>
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
            {t("welcome.catch_p1", { defaultValue: "This tool cannot protect you from anything. It can only show you what is already visible to anyone running the same heuristics. If the result scares you, that is the point. Now you know what they know." })}
          </p>
        </section>

        {/* --- CTA --- */}
        <section className="flex flex-col items-center gap-4 pt-4">
          <Link
            href={href("/")}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-bitcoin text-black font-semibold text-base hover:bg-bitcoin/90 transition-colors"
          >
            {t("welcome.cta", { defaultValue: "Scan your first transaction" })}
            <ArrowRight size={18} />
          </Link>
          <div className="flex items-center gap-6">
            <a
              href="https://github.com/Copexit/am-i-exposed"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
            >
              <Github size={14} />
              {t("welcome.github_link", { defaultValue: "View source on GitHub" })}
            </a>
            <Link
              href={href("/setup-guide/")}
              className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
            >
              <Server size={14} />
              {t("welcome.selfhost_link", { defaultValue: "Run your own instance" })}
            </Link>
          </div>
        </section>
      </article>
    </div>
  );
}
