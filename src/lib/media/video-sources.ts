export type VideoLang = "en" | "es";

export function pickVideoLang(uiLang: string): VideoLang {
  return uiLang.toLowerCase().startsWith("es") ? "es" : "en";
}

export function promoSource(lang: VideoLang, portrait: boolean) {
  const n = `/media/promo-${lang}-${portrait ? "9x16" : "16x9"}`;
  return { src: `${n}.mp4`, poster: `${n}.webp`, aspect: portrait ? ("9/16" as const) : ("16/9" as const) };
}

export function tutorialSource(lang: VideoLang) {
  const n = `/media/tutorial-${lang}-16x9`;
  return { src: `${n}.mp4`, poster: `${n}.webp`, aspect: "16/9" as const };
}

export interface SubtitleTrack {
  lang: string;
  label: string;
  src: string;
  default: boolean;
}

const TRACKS = [
  ["en", "English"],
  ["es", "Español"],
  ["de", "Deutsch"],
  ["fr", "Français"],
  ["pt", "Português"],
  ["pl", "Polski"],
] as const;

export function subtitleTracks(uiLang: string): SubtitleTrack[] {
  const base = uiLang.toLowerCase().split("-")[0] ?? "";
  const def = TRACKS.some(([l]) => l === base) ? base : "en";
  return TRACKS.map(([lang, label]) => ({ lang, label, src: `/media/tutorial-${lang}.vtt`, default: lang === def }));
}
