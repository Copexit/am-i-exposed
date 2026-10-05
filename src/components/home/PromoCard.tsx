"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
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

  return (
    <div className="mb-8 md:mb-10 max-w-3xl">
      <h3 className="text-lg font-semibold tracking-tight mb-3">{t("home.promo_title", { defaultValue: "See it in one minute" })}</h3>
      <PosterVideo
        resolve={resolve}
        poster={initial.poster}
        aspect={initial.aspect}
        playLabel={t("home.promo_play", { defaultValue: "Play the 1-minute overview" })}
        videoLabel={t("home.promo_video", { defaultValue: "am-i.exposed in one minute" })}
      />
      <Link href="/tutorial/" className="mt-3 inline-block text-sm text-bitcoin hover:underline">
        {t("home.promo_tutorial_link", { defaultValue: "Watch the 5-minute tutorial" })}
      </Link>
    </div>
  );
}
