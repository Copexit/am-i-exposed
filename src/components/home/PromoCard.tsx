"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { PosterVideo } from "@/components/media/PosterVideo";
import { pickVideoLang, promoSource } from "@/lib/media/video-sources";

const Q = "(orientation: portrait)";
const isPortrait = () => window.matchMedia(Q).matches;
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(Q);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/** Home promo: poster until clicked. Poster/aspect follow orientation and language without layout drift. */
export function PromoCard() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  // server and hydration render 16:9; the client snapshot then matches what resolve() returns at click
  const portrait = useSyncExternalStore(subscribe, isPortrait, () => false);
  const initial = promoSource(pickVideoLang(lang), portrait);

  const resolve = useCallback(() => promoSource(pickVideoLang(lang), isPortrait()), [lang]);

  // Phones/tablets: heading, video, link stacked. lg: video left (7/12), heading, lead and CTA right.
  return (
    <div className="mb-8 md:mb-10 max-w-3xl lg:max-w-none lg:grid lg:grid-cols-12 lg:gap-x-10 lg:gap-y-5">
      <div className="lg:col-start-8 lg:col-span-5 lg:row-start-1 lg:self-end">
        <h3 className="text-lg lg:text-2xl font-semibold tracking-tight mb-3">{t("home.promo_title", { defaultValue: "See it in one minute" })}</h3>
        <p className="hidden lg:block text-muted leading-relaxed">
          {t("home.promo_lead", { defaultValue: "The whole idea in sixty seconds: what a chain analyst sees, and how a CoinJoin breaks the trail." })}
        </p>
      </div>
      <PosterVideo
        resolve={resolve}
        poster={initial.poster}
        aspect={initial.aspect}
        playLabel={t("home.promo_play", { defaultValue: "Play the 1-minute overview" })}
        videoLabel={t("home.promo_video", { defaultValue: "am-i.exposed in one minute" })}
        className="lg:col-span-7 lg:row-start-1 lg:row-span-2"
      />
      <div className="lg:col-start-8 lg:col-span-5 lg:row-start-2 lg:self-start">
        {/* lg CTA: text-black! beats the light-theme .text-bitcoin remap in globals.css */}
        <Link
          href="/tutorial/"
          className="mt-3 lg:mt-0 inline-flex items-center gap-2 text-sm text-bitcoin hover:underline lg:rounded-lg lg:bg-bitcoin lg:px-4 lg:py-2.5 lg:font-semibold lg:text-black! lg:hover:no-underline lg:hover:bg-bitcoin-hover transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bitcoin"
        >
          {t("home.promo_tutorial_link", { defaultValue: "Watch the 5-minute tutorial" })}
          <ArrowRight size={16} aria-hidden="true" className="hidden lg:block" />
        </Link>
      </div>
    </div>
  );
}
