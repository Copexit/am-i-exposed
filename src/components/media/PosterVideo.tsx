"use client";

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Play } from "lucide-react";
import type { SubtitleTrack } from "@/lib/media/video-sources";

export interface PosterVideoHandle { seek(seconds: number): void }
type Aspect = "16/9" | "9/16";
interface Resolved { src: string; poster: string; aspect: Aspect }
export interface PosterVideoProps {
  resolve: () => Resolved;
  poster: string;
  aspect: Aspect;
  tracks?: SubtitleTrack[];
  playLabel: string;
  videoLabel: string;
  className?: string;
}

export const PosterVideo = forwardRef<PosterVideoHandle, PosterVideoProps>(function PosterVideo(
  { resolve, poster, aspect, tracks, playLabel, videoLabel, className },
  ref,
) {
  const { t } = useTranslation();
  const [media, setMedia] = useState<Resolved | null>(null);
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pending = useRef<number | null>(null);
  const mounted = useRef(false);

  const start = useCallback(() => {
    if (mounted.current) return;
    mounted.current = true; // resolved once; rotation mid-play keeps the source
    setMedia(resolve());
  }, [resolve]);

  const play = (v: HTMLVideoElement) => { v.play()?.catch(() => {}); };

  useImperativeHandle(ref, () => ({
    seek(seconds: number) {
      const v = videoRef.current;
      if (!v) { pending.current = seconds; start(); return; }
      v.currentTime = seconds;
      play(v);
    },
  }), [start]);

  const a = media?.aspect ?? aspect;
  const portrait = a === "9/16";
  const box = `relative overflow-hidden rounded-2xl border border-hairline bg-surface-inset ${
    portrait ? "mx-auto max-h-[80vh] w-auto" : "w-full"
  } ${className ?? ""}`;
  const style = { aspectRatio: a.replace("/", " / ") };

  if (failed && media) {
    return (
      <div className={`${box} flex flex-col items-center justify-center gap-2 p-4 text-center`} style={style}>
        <p className="text-sm text-muted">{t("video.error")}</p>
        <a href={media.src} target="_blank" rel="noopener noreferrer" className="text-sm text-bitcoin underline">
          {t("video.openFile")}
        </a>
      </div>
    );
  }

  if (!media) {
    return (
      <div className={box} style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />
        <button
          type="button"
          onClick={start}
          aria-label={playLabel}
          className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-hairline bg-surface-inset/80 text-bitcoin backdrop-blur transition-colors hover:bg-surface-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bitcoin cursor-pointer"
        >
          <Play size={28} aria-hidden="true" className="ml-1" />
        </button>
      </div>
    );
  }

  return (
    <div className={box} style={style}>
      <video
        ref={videoRef}
        src={media.src}
        poster={media.poster}
        controls
        playsInline
        autoPlay
        preload="none"
        aria-label={videoLabel}
        className="h-full w-full bg-black"
        onError={() => setFailed(true)}
        onLoadedMetadata={(e) => {
          if (pending.current === null) return;
          e.currentTarget.currentTime = pending.current;
          pending.current = null;
          play(e.currentTarget);
        }}
      >
        {tracks?.map((tr) => (
          <track key={tr.lang} kind="subtitles" srcLang={tr.lang} label={tr.label} src={tr.src} default={tr.default} />
        ))}
      </video>
    </div>
  );
});
