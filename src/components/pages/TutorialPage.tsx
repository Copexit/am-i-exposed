"use client";

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { PageShell } from "@/components/PageShell";
import { PosterVideo, type PosterVideoHandle } from "@/components/media/PosterVideo";
import { VIDEOS_ENABLED } from "@/lib/media/videos-enabled";
import { pickVideoLang, subtitleTracks, tutorialSource } from "@/lib/media/video-sources";
import { TUTORIAL_CHAPTERS, formatTime } from "@/lib/media/tutorial-chapters";
import { EXAMPLES } from "@/lib/constants";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bitcoin";
// Scans shown in the tutorial video; /#tx= and /#addr= are the hash routes the home page uses.
const TRY_LABELS = [
  "page.example_whirlpool",
  "page.example_reuse",
  "page.example_satoshi",
  "page.presend_fresh",
];
const TRY = TRY_LABELS.map((k) => EXAMPLES.find((e) => e.labelKey === k)).filter((e) => e !== undefined);

export function TutorialPage() {
  const { t, i18n } = useTranslation();
  const ref = useRef<PosterVideoHandle>(null);

  if (!VIDEOS_ENABLED) {
    return (
      <PageShell>
        <div className="py-16 text-center space-y-3">
          <p className="text-muted">{t("tutorial.unavailable", { defaultValue: "The video tutorial is available on am-i.exposed." })}</p>
          <a href="https://am-i.exposed/tutorial/" className="text-bitcoin underline">am-i.exposed/tutorial</a>
        </div>
      </PageShell>
    );
  }

  const lang = pickVideoLang(i18n.language);
  const src = tutorialSource(lang);

  return (
    <PageShell>
      <div className="space-y-3">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">{t("tutorial.title", { defaultValue: "How to use am-i.exposed" })}</h1>
        <p className="text-muted text-lg leading-relaxed max-w-3xl">{t("tutorial.intro")}</p>
      </div>

      <PosterVideo
        ref={ref}
        resolve={() => src}
        poster={src.poster}
        aspect={src.aspect}
        tracks={subtitleTracks(i18n.language)}
        playLabel={t("tutorial.play")}
        videoLabel={t("tutorial.video")}
      />

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">{t("tutorial.chapters")}</h2>
        <ol className="space-y-1">
          {TUTORIAL_CHAPTERS.map((c) => {
            const time = formatTime(c.start[lang]);
            const title = t(`tutorial.chapter.${c.id}`);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-label={t("tutorial.jump", { time, title })}
                  onClick={() => ref.current?.seek(c.start[lang])}
                  className={`min-h-[44px] w-full rounded-lg px-3 text-left text-sm text-muted hover:text-foreground transition-colors cursor-pointer ${FOCUS}`}
                >
                  <span className="num text-bitcoin">{time}</span>
                  {"  "}
                  {title}
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">{t("tutorial.try_title")}</h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {TRY.map((ex) => (
            <li key={ex.input}>
              <a
                href={`/#${ex.input.length === 64 ? "tx" : "addr"}=${ex.input}`}
                className={`flex min-h-[44px] items-baseline justify-between gap-2 rounded-xl border border-hairline bg-surface-1/80 px-3 py-2.5 hover:border-hairline-strong transition-colors ${FOCUS}`}
              >
                <span className="text-sm font-semibold text-foreground">{t(ex.labelKey, { defaultValue: ex.labelDefault })}</span>
                <span className={`text-xl font-extrabold ${ex.hintColor}`}>{ex.hintKey ? t(ex.hintKey, { defaultValue: ex.hint }) : ex.hint}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
