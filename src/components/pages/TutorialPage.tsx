"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Link as LinkIcon } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { PageShell } from "@/components/PageShell";
import { PosterVideo, type PosterVideoHandle } from "@/components/media/PosterVideo";
import { VIDEOS_ENABLED } from "@/lib/media/videos-enabled";
import { graphTutorialSource, pickVideoLang, subtitleTracks, tutorialSource, type VideoLang } from "@/lib/media/video-sources";
import { GRAPH_TUTORIAL_CHAPTERS, TUTORIAL_CHAPTERS, formatTime } from "@/lib/media/tutorial-chapters";
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
const GRAPH = graphTutorialSource();

const linkTo = (id: string) => `${location.origin}${location.pathname}#${id}`;

/** Section heading with its own anchor and a copy-link button. */
function SectionHeading({ id, as: Tag = "h2", className, children }: { id: string; as?: "h2" | "h3"; className: string; children: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    history.replaceState(null, "", `#${id}`);
    if (!(await copyToClipboard(linkTo(id)))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="group flex items-center gap-1.5">
      <Tag id={id} className={className}>{children}</Tag>
      <button
        type="button"
        onClick={copy}
        aria-label={`${t("share.copyLink", { defaultValue: "Copy link" })}: ${children}`}
        title={copied ? t("share.copied", { defaultValue: "Copied" }) : t("share.copyLink", { defaultValue: "Copy link" })}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:text-foreground transition-colors cursor-pointer ${FOCUS}`}
      >
        {copied ? <Check size={16} aria-hidden="true" className="text-severity-good" /> : <LinkIcon size={16} aria-hidden="true" />}
      </button>
      <span className="sr-only" role="status">{copied ? t("share.copied", { defaultValue: "Copied" }) : ""}</span>
    </div>
  );
}

interface Chapter { id: string; start: number; title: string }

/** Chapter jump buttons; each click also puts the chapter's link (`#<prefix>-<id>`) in the address bar. */
function ChapterList({ prefix, chapters, current, seek }: { prefix: string; chapters: Chapter[]; current: string | null; seek: (s: number) => void }) {
  const { t } = useTranslation();
  return (
    <ol className="space-y-1">
      {chapters.map((c) => {
        const time = formatTime(c.start);
        const hash = `${prefix}-${c.id}`;
        return (
          <li key={c.id}>
            <button
              type="button"
              aria-label={t("tutorial.jump", { time, title: c.title })}
              aria-current={current === hash ? "true" : undefined}
              onClick={() => { history.replaceState(null, "", `#${hash}`); seek(c.start); }}
              className={`min-h-[44px] w-full rounded-lg px-3 text-left text-sm transition-colors cursor-pointer ${
                current === hash ? "bg-surface-1 text-foreground" : "text-muted hover:text-foreground"
              } ${FOCUS}`}
            >
              <span className="num text-bitcoin">{time}</span>
              <span className="ml-2">{c.title}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function TutorialPage() {
  const { t, i18n } = useTranslation();
  const ref = useRef<PosterVideoHandle>(null);
  const graphRef = useRef<PosterVideoHandle>(null);
  // Language of the mounted video: chapter times must keep matching it after a UI language switch.
  const [playedLang, setPlayedLang] = useState<VideoLang | null>(null);
  // Chapter named by the URL hash (a shared chapter link)
  const [current, setCurrent] = useState<string | null>(null);

  const lang = playedLang ?? pickVideoLang(i18n.language);
  const chapters: Chapter[] = TUTORIAL_CHAPTERS.map((c) => ({ id: c.id, start: c.start[lang], title: t(`tutorial.chapter.${c.id}`) }));
  const graphChapters: Chapter[] = GRAPH_TUTORIAL_CHAPTERS.map((c) => ({ id: c.id, start: c.start, title: t(`tutorial.graph.chapter.${c.id}`) }));
  // Read by the hash handler, which is bound once
  const cues = useRef<{ hash: string; start: number; video: React.RefObject<PosterVideoHandle | null>; anchor: string }[]>([]);
  useEffect(() => {
    cues.current = [
      ...chapters.map((c) => ({ hash: `tutorial-${c.id}`, start: c.start, video: ref, anchor: "tutorial" })),
      ...graphChapters.map((c) => ({ hash: `graph-tutorial-${c.id}`, start: c.start, video: graphRef, anchor: "graph-tutorial" })),
    ];
  });

  useEffect(() => {
    if (!VIDEOS_ENABLED) return;
    const apply = () => {
      const cue = cues.current.find((c) => `#${c.hash}` === location.hash);
      setCurrent(cue?.hash ?? null);
      if (!cue) return;
      cue.video.current?.cue(cue.start);
      document.getElementById(cue.anchor)?.scrollIntoView();
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

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

  const src = tutorialSource(lang);
  const seekMain = (sec: number) => ref.current?.seek(sec);
  const seekGraph = (sec: number) => graphRef.current?.seek(sec);

  return (
    <PageShell>
      <div className="space-y-3">
        <h1 id="tutorial" className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">{t("tutorial.title", { defaultValue: "How to use am-i.exposed" })}</h1>
        <p className="text-muted text-lg leading-relaxed max-w-3xl">{t("tutorial.intro")}</p>
      </div>

      <PosterVideo
        ref={ref}
        resolve={() => { setPlayedLang(lang); return src; }}
        poster={src.poster}
        aspect={src.aspect}
        tracks={subtitleTracks(i18n.language)}
        playLabel={t("tutorial.play")}
        videoLabel={t("tutorial.video")}
      />

      <section className="space-y-3">
        <SectionHeading id="chapters" className="text-xl font-semibold text-foreground">{t("tutorial.chapters")}</SectionHeading>
        <ChapterList prefix="tutorial" chapters={chapters} current={current} seek={seekMain} />
      </section>

      <section className="space-y-3">
        <SectionHeading id="try" className="text-xl font-semibold text-foreground">{t("tutorial.try_title")}</SectionHeading>
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

      <section className="space-y-3" aria-labelledby="graph-tutorial">
        <SectionHeading id="graph-tutorial" className="text-2xl font-semibold text-foreground">{t("tutorial.graph.title")}</SectionHeading>
        <p className="text-muted leading-relaxed max-w-3xl">{t("tutorial.graph.intro")}</p>
        <PosterVideo
          ref={graphRef}
          resolve={() => GRAPH}
          poster={GRAPH.poster}
          aspect={GRAPH.aspect}
          tracks={subtitleTracks(i18n.language, "graph-tutorial", ["en", "es"])}
          playLabel={t("tutorial.graph.play")}
          videoLabel={t("tutorial.graph.title")}
        />
        <SectionHeading id="graph-chapters" as="h3" className="text-lg font-semibold text-foreground">{t("tutorial.chapters")}</SectionHeading>
        <ChapterList prefix="graph-tutorial" chapters={graphChapters} current={current} seek={seekGraph} />
      </section>
    </PageShell>
  );
}
