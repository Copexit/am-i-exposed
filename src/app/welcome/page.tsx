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
            {t("welcome.why_heading")}
          </h2>
          <div className="space-y-4 text-muted leading-relaxed">
            <p>{t("welcome.why_p1")}</p>
            <p>{t("welcome.why_p2")}</p>
            <p className="font-medium text-foreground">{t("welcome.why_p3")}</p>
          </div>
        </section>

        {/* --- What it is --- */}
        <section className="space-y-5">
          <p className="text-xl sm:text-2xl font-semibold text-bitcoin leading-snug">
            {t("welcome.hero_tagline")}
          </p>
          <p className="text-muted leading-relaxed">
            {t("welcome.hero_desc")}
          </p>
        </section>

        {/* --- What it is not --- */}
        <section className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("welcome.not_heading")}
          </h2>
          <div className="space-y-4 text-muted leading-relaxed">
            <p>{t("welcome.not_p1")}</p>
            <p>{t("welcome.not_p2")}</p>
          </div>
        </section>

        {/* --- The vision --- */}
        <section className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("welcome.vision_heading")}
          </h2>
          <div className="space-y-4 text-muted leading-relaxed">
            <p className="font-medium text-foreground">{t("welcome.vision_p1")}</p>
            <p>{t("welcome.vision_p2")}</p>
            <p>{t("welcome.vision_p3")}</p>
            <p>{t("welcome.vision_p4")}</p>
            <p>{t("welcome.vision_p5")}</p>
          </div>
        </section>

        {/* --- The money question --- */}
        <section className="space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("welcome.money_heading")}
          </h2>
          <div className="space-y-4 text-muted leading-relaxed">
            <p>{t("welcome.money_p1")}</p>
            <p>{t("welcome.money_p2")}</p>
            <p>{t("welcome.money_p3")}</p>
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
            {t("welcome.catch_heading")}
          </h2>
          <p className="text-muted leading-relaxed">
            {t("welcome.catch_p1")}
          </p>
        </section>

        {/* --- CTA --- */}
        <section className="flex flex-col items-center gap-4 pt-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-bitcoin text-black font-semibold text-base hover:bg-bitcoin/90 transition-colors"
          >
            {t("welcome.cta")}
            <ArrowRight size={18} />
          </Link>
          <a
            href="https://github.com/Copexit/am-i-exposed"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
          >
            <Github size={14} />
            {t("welcome.github_link")}
          </a>
        </section>
      </article>
    </div>
  );
}
