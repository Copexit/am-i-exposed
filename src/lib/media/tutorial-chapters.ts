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

/** Graph tutorial (English narration), from the build's edit list. */
export const GRAPH_TUTORIAL_CHAPTERS: { id: string; start: number }[] = [
  { id: "what", start: 3.4 },
  { id: "open", start: 43.27 },
  { id: "nodes", start: 84.1 },
  { id: "expand", start: 128.1 },
  { id: "lines", start: 175.67 },
  { id: "ports", start: 229.17 },
  { id: "reading", start: 296.4 },
  { id: "connection", start: 384.43 },
  { id: "time", start: 468.07 },
  { id: "select", start: 490.07 },
  { id: "labels", start: 532.8 },
  { id: "save", start: 555.03 },
  { id: "bip329", start: 578.67 },
  { id: "investigation", start: 612.47 },
  { id: "recap", start: 653.03 },
];

export function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
