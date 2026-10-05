import type { VideoLang } from "./video-sources";

export const TUTORIAL_CHAPTERS: { id: string; start: Record<VideoLang, number> }[] = [
  { id: "intro", start: { en: 3.2, es: 3.2 } },
  { id: "home", start: { en: 32.33, es: 32.97 } },
  { id: "scan-tx", start: { en: 66.6, es: 68.77 } },
  { id: "coinjoin", start: { en: 161.43, es: 169.3 } },
  { id: "analyst", start: { en: 198.6, es: 203.7 } },
  { id: "address", start: { en: 225.73, es: 235.7 } },
  { id: "more-privacy", start: { en: 251.7, es: 261.13 } },
];

export function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
