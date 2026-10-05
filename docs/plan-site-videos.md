# Site Videos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the 60 s promo on the home page and the narrated tutorial on a new `/tutorial` page, on the GitHub Pages site only.

**Architecture:** Web encodes, posters and WebVTT subtitles live in `public/media/` (excluded from Docker). A build-time flag `NEXT_PUBLIC_VIDEOS=1`, set only by the Pages deploy workflow, gates every video entry point. A pure `video-sources` module picks files by UI language and orientation; one `PosterVideo` component renders a poster box and mounts the native `<video>` only after a click.

**Tech Stack:** Next.js 16 static export, React 19, Tailwind 4, react-i18next, Vitest, Playwright, ffmpeg 6.1.

**Spec:** `docs/spec-site-videos.md`

## Global Constraints

- Worktree `/home/user/aie-videos`, branch `feat/site-videos`. Never work in `/home/user/am-i-exposed`. Never `git stash`. Never push or merge without the owner's go.
- Commits: repo-local identity (Copexit); never `-c user.*`; no Co-Authored-By or any AI attribution.
- No em dashes; no "we/us/our" in UI copy; es Castilian tuteo; every new key in all 6 locales (`public/locales/{en,es,de,fr,pt,pl}/common.json`), locale-parity test green.
- TypeScript strict, no `any`; Tailwind semantic tokens; `motion/react` only if animation is needed (it is not required here).
- Video files: 720p H.264 (High), 30 fps, `+faststart`; promo AAC 128k stereo, tutorial AAC 96k mono; targets promo 6-9 MB, tutorial 12-18 MB.
- `<video>`: `controls playsInline preload="none"`, mounted only after the play click; no autoplay before a click; same-origin `src`; no third-party requests.
- Language: UI `es` -> es video; any other UI language -> en video. Subtitles (tutorial only) default to the UI language, falling back to en.
- Orientation (promo only): `matchMedia("(orientation: portrait)")` at click time -> 9:16, else 16:9.
- Flag off: no video UI anywhere; `/tutorial` renders the note "The video tutorial is available on am-i.exposed" with a link, and `robots: noindex`.
- Memory is tight: targeted vitest while iterating; e2e serially (`--workers=1`); never kill browser processes. Restore `public/sitemap.xml` after builds (`git checkout -- public/sitemap.xml`) unless a task intends to change it.

## Review Focus

1. A visitor on a phone held upright gets the 9:16 promo; rotating after playback started does not swap or restart the video. Pinned in Task 4.
2. A Polish/German/French/Portuguese visitor gets the English tutorial with subtitles in their own language, on by default. Pinned in Task 2 and Task 5.
3. Self-hosted build: zero video UI and no `/media/` request on any page, including `/tutorial` reached directly. Pinned in Task 6.
4. A missing or failing media file shows a readable error with a link, not a black box. Pinned in Task 3.
5. No media byte is requested before the click (posters are images and allowed). Pinned in Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/encode-media.sh` | Masters dir -> `public/media/*` (mp4, webp posters, en/es vtt) |
| `public/media/*` | Web encodes, posters, 6 VTT tracks |
| `src/lib/media/videos-enabled.ts` | `VIDEOS_ENABLED` build-time flag |
| `src/lib/media/video-sources.ts` | Pure source/poster/track selection |
| `src/lib/media/tutorial-chapters.ts` | Chapter ids + per-language start times |
| `src/components/media/PosterVideo.tsx` | Poster box, play button, lazy `<video>`, error state, `seek` handle |
| `src/components/home/PromoCard.tsx` | Home card (orientation at click) + tutorial link |
| `src/components/pages/TutorialPage.tsx`, `src/app/tutorial/{page,layout,opengraph-image,twitter-image}.tsx` | `/tutorial` |
| Modified: `HowItWorks.tsx` (or `Home.tsx` where the section is composed), `chrome/nav.ts` + header, `chrome/SiteFooter.tsx`, `pages/AboutPage.tsx`, `pages/WelcomePage.tsx`, `.dockerignore`, `.github/workflows/deploy.yml`, `scripts/generate-sitemap.mjs`, locales, `docs/README.md` | Wiring |

---

### Task 1: Media assets and encode script

**Files:** Create `scripts/encode-media.sh`, `public/media/*`, `src/lib/media/__tests__/media-assets.test.ts`.

**Interfaces - Produces:** files `public/media/promo-{en,es}-{16x9,9x16}.{mp4,webp}`, `public/media/tutorial-{en,es}-16x9.{mp4,webp}`, `public/media/tutorial-{en,es,de,fr,pt,pl}.vtt`.

- [ ] **Step 1: Write the asset test (fails: files missing)**

```ts
// src/lib/media/__tests__/media-assets.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const M = join(process.cwd(), "public/media");
const LANGS = ["en", "es", "de", "fr", "pt", "pl"] as const;
const cues = (vtt: string) => vtt.split(/\r?\n/).filter((l) => l.includes("-->"));

describe("media assets", () => {
  it.each(["promo-en-16x9", "promo-es-16x9", "promo-en-9x16", "promo-es-9x16", "tutorial-en-16x9", "tutorial-es-16x9"])("%s mp4 + webp exist and are small", (n) => {
    expect(existsSync(join(M, `${n}.mp4`))).toBe(true);
    expect(existsSync(join(M, `${n}.webp`))).toBe(true);
    expect(statSync(join(M, `${n}.mp4`)).size).toBeLessThan(20 * 1024 * 1024);
  });
  it.each(LANGS)("tutorial-%s.vtt is WebVTT", (l) => {
    const v = readFileSync(join(M, `tutorial-${l}.vtt`), "utf-8");
    expect(v.startsWith("WEBVTT")).toBe(true);
    expect(cues(v).length).toBeGreaterThan(50);
  });
  it("de/fr/pt/pl keep the English cue timings", () => {
    const en = cues(readFileSync(join(M, "tutorial-en.vtt"), "utf-8"));
    for (const l of ["de", "fr", "pt", "pl"]) expect(cues(readFileSync(join(M, `tutorial-${l}.vtt`), "utf-8"))).toEqual(en);
  });
});
```

- [ ] **Step 2: Write `scripts/encode-media.sh`**

```bash
#!/usr/bin/env bash
# Web encodes of the am-i.exposed videos for the GitHub Pages site (public/media).
# Usage: scripts/encode-media.sh ~/Videos/am-i-exposed
set -euo pipefail
SRC="${1:?masters directory}"; OUT="$(dirname "$0")/../public/media"; mkdir -p "$OUT"
enc() { # in out scale crf audio
  ffmpeg -nostdin -y -loglevel error -i "$1" -vf "scale=$3:flags=lanczos,fps=30" \
    -c:v libx264 -profile:v high -preset slow -crf "$4" -pix_fmt yuv420p \
    $5 -movflags +faststart "$OUT/$2.mp4"
}
poster() { ffmpeg -nostdin -y -loglevel error -ss "$3" -i "$OUT/$1.mp4" -frames:v 1 -c:v libwebp -quality 80 "$OUT/$2.webp"; }
for L in en es; do
  enc "$SRC/am-i-exposed-$L-16x9.mp4" "promo-$L-16x9" 1280:720 "${PROMO_CRF:-24}" "-c:a aac -b:a 128k"
  enc "$SRC/am-i-exposed-$L-9x16.mp4" "promo-$L-9x16" 720:1280 "${PROMO_CRF:-24}" "-c:a aac -b:a 128k"
  enc "$SRC/tutorial/tutorial-$L-16x9.mp4" "tutorial-$L-16x9" 1280:720 "${TUT_CRF:-23}" "-c:a aac -b:a 96k -ac 1"
  poster "promo-$L-16x9" "promo-$L-16x9" "${PROMO_POSTER_T:-44}"
  poster "promo-$L-9x16" "promo-$L-9x16" "${PROMO_POSTER_T:-44}"
  poster "tutorial-$L-16x9" "tutorial-$L-16x9" "${TUT_POSTER_T:-120}"
  # SRT -> WebVTT (comma -> dot in timestamps)
  { echo "WEBVTT"; echo; sed -E 's/([0-9]{2}:[0-9]{2}:[0-9]{2}),([0-9]{3})/\1.\2/g' "$SRC/tutorial/tutorial-$L.srt" | tr -d '\r'; } > "$OUT/tutorial-$L.vtt"
done
ls -la "$OUT"
```

Run: `bash scripts/encode-media.sh /home/user/Videos/am-i-exposed`. Tune `PROMO_CRF`/`TUT_CRF` to hit the size targets; pick poster times showing the A+ verdict (promo, about 43-44 s) and a results screen (tutorial). Extract one 720p tutorial frame with small UI text (e.g. at 100 s) to `/tmp/claude-1000/-home-user-am-i-exposed/d185653b-aaac-4491-8142-ca457266cb7e/scratchpad/tut-720-check.png` and report its path (the controller judges legibility before commit).

- [ ] **Step 3: Translate subtitles.** Create `tutorial-{de,fr,pt,pl}.vtt` from `tutorial-en.vtt`: identical cue numbers and timing lines, text translated naturally (concise, subtitle-length, product name "am-i.exposed" unchanged, "CoinJoin", "txid", "PSBT", "xpub" untranslated). No em dashes.

- [ ] **Step 4: Run** `pnpm vitest run src/lib/media` -> PASS. Commit `scripts/encode-media.sh public/media src/lib/media/__tests__/media-assets.test.ts` with message `feat(media): web encodes, posters and subtitles for the site videos`.

---

### Task 2: Flag, sources, chapters, build wiring

**Files:** Create `src/lib/media/videos-enabled.ts`, `video-sources.ts`, `tutorial-chapters.ts`, tests in `src/lib/media/__tests__/`. Modify `.dockerignore`, `.github/workflows/deploy.yml`, `scripts/generate-sitemap.mjs`.

**Interfaces - Produces:**
```ts
export const VIDEOS_ENABLED: boolean; // process.env.NEXT_PUBLIC_VIDEOS === "1"
export type VideoLang = "en" | "es";
export function pickVideoLang(uiLang: string): VideoLang;            // "es*" -> es, else en
export function promoSource(lang: VideoLang, portrait: boolean): { src: string; poster: string; aspect: "16/9" | "9/16" };
export function tutorialSource(lang: VideoLang): { src: string; poster: string; aspect: "16/9" };
export interface SubtitleTrack { lang: string; label: string; src: string; default: boolean }
export function subtitleTracks(uiLang: string): SubtitleTrack[];      // 6 tracks; default = UI lang base, unknown -> en
export const TUTORIAL_CHAPTERS: { id: string; start: Record<VideoLang, number> }[]; // 7 entries, ids: intro, home, scan-tx, coinjoin, analyst, address, more-privacy
export function formatTime(seconds: number): string;                 // 161.43 -> "2:41"
```
Paths are absolute from the site root: `/media/promo-en-16x9.mp4`. Track labels are native language names (English, Español, Deutsch, Français, Português, Polski).

- [ ] **Step 1: Tests** (`video-sources.test.ts`): `pickVideoLang("es")`/`("es-ES")` -> es; `"de"`, `"pl"`, `"en-US"` -> en; `promoSource("es", true)` -> `/media/promo-es-9x16.mp4`, aspect `9/16`; `promoSource("en", false)` -> 16x9; `subtitleTracks("pl")` has 6 entries, exactly one default with lang `pl`; `subtitleTracks("xx")` default `en`; chapters: 7, starts strictly increasing per language, en values `[3.2, 32.33, 66.6, 161.43, 198.6, 225.73, 251.7]`, es `[3.2, 32.97, 68.77, 169.3, 203.7, 235.7, 261.13]`; `formatTime(161.43) === "2:41"`, `formatTime(3.2) === "0:03"`. A test that `.dockerignore` contains a line `public/media`. A test that `.github/workflows/deploy.yml` contains `NEXT_PUBLIC_VIDEOS: "1"`.
- [ ] **Step 2: Implement** the three modules (pure, no React).
- [ ] **Step 3: Build wiring:** `.dockerignore` add `public/media`; `deploy.yml` add `env: NEXT_PUBLIC_VIDEOS: "1"` to the `pnpm build` step only; `generate-sitemap.mjs` add `{ path: "/tutorial/", priority: "0.7", changefreq: "monthly", source: "src/app/tutorial/page.tsx" }` only when `process.env.NEXT_PUBLIC_VIDEOS === "1"` (check how PAGES is consumed; `source` may be used for lastmod, so the file must exist at build: Task 5 creates it; guard with `existsSync`).
- [ ] **Step 4:** `pnpm vitest run src/lib/media && pnpm type-check && pnpm lint` -> PASS. Commit.

---

### Task 3: PosterVideo component

**Files:** Create `src/components/media/PosterVideo.tsx`, `src/components/media/__tests__/PosterVideo.test.tsx`.

**Interfaces - Produces:**
```ts
export interface PosterVideoHandle { seek(seconds: number): void }  // seeks; if not started yet, starts playback at that time
export interface PosterVideoProps {
  resolve: () => { src: string; poster: string; aspect: "16/9" | "9/16" }; // called at click time (orientation/lang decided then)
  poster: string; aspect: "16/9" | "9/16";                                  // initial poster box
  tracks?: SubtitleTrack[];
  playLabel: string;    // accessible name of the play button
  videoLabel: string;   // aria-label of <video>
  className?: string;
}
export const PosterVideo: React.ForwardRefExoticComponent<PosterVideoProps & React.RefAttributes<PosterVideoHandle>>;
```
Behavior: before click, render a `<button>` over an `<img>` poster (`loading="lazy"`, `alt=""`) inside a box with CSS `aspect-ratio` = aspect; on click call `resolve()`, then render `<video src controls playsInline autoPlay preload="none" poster aria-label>` with `<track kind="subtitles" srcLang label src default?>` children (set `crossOrigin` not needed: same origin), swapping the box aspect to the resolved one. Once mounted, never re-resolve (Review Focus 1). `onError` on the video -> render the error text (`video.error` key) with a link to `src` (`target="_blank" rel="noopener noreferrer"`). 9:16 box: `max-h-[80vh] mx-auto` with width derived from aspect. Keyboard: the button is focusable; Enter/Space play.

- [ ] **Step 1: Tests:** no `<video>` before click and the poster img is present; click -> `<video>` with the resolved src, `playsInline`, `preload="none"`, tracks rendered with exactly one `default`; `resolve` called once, and a second interaction does not change src; `fireEvent.error(video)` shows the error text and a link to src; `ref.seek(42)` before start -> video mounted and `currentTime` set to 42 (stub `HTMLMediaElement.prototype.play` to resolve).
- [ ] **Step 2: Implement.** Keys: `video.play` is NOT a generic key; the caller passes labels. Add `video.error` ("The video could not be loaded.") and `video.openFile` ("Open the video file") in 6 locales.
- [ ] **Step 3:** targeted tests + type-check + lint. Commit.

---

### Task 4: Home promo card and links

**Files:** Create `src/components/home/PromoCard.tsx` + test. Modify the home "How it works" section (`src/components/home/HowItWorks.tsx` or where `Home.tsx` composes it), `src/components/chrome/nav.ts` (+ header component rendering it), `src/components/chrome/SiteFooter.tsx`, `src/components/pages/AboutPage.tsx`, `src/components/pages/WelcomePage.tsx`, locales.

**Interfaces - Consumes:** `VIDEOS_ENABLED`, `pickVideoLang`, `promoSource`, `PosterVideo`.

Behavior: when `VIDEOS_ENABLED`, at the top of "How it works" render `PromoCard`: heading (`home.promo_title` "See it in one minute"), `PosterVideo` with `resolve = () => promoSource(pickVideoLang(i18n.language), matchMedia("(orientation: portrait)").matches)`, initial poster/aspect from the same call evaluated on mount (SSR-safe: default 16:9 on the server, update in an effect), and a link `home.promo_tutorial_link` "Watch the 5-minute tutorial" to `/tutorial/`. Nav: append `{ href: "/tutorial/", key: "common.tutorial", label: "Tutorial" }` only when enabled (export a function or filtered constant; keep `isNavActive` working). Footer, About (next to the existing /guide and /welcome links around AboutPage.tsx:224) and Welcome: one link each, gated. When disabled, everything renders exactly as today.

- [ ] **Step 1: Tests:** with the flag mocked on (`vi.mock("@/lib/media/videos-enabled", () => ({ VIDEOS_ENABLED: true }))`): portrait matchMedia -> click plays `/media/promo-<lang>-9x16.mp4`; landscape -> 16x9; i18n `es` -> es file, `de` -> en file; nav contains Tutorial; footer/About/Welcome contain a `/tutorial/` link. With the flag off: none of these render (snapshot-free assertions).
- [ ] **Step 2: Implement + locales** (en/es given; translate de/fr/pt/pl): `common.tutorial` "Tutorial" / "Tutorial"; `home.promo_title` "See it in one minute" / "Míralo en un minuto"; `home.promo_play` "Play the 1-minute overview" / "Reproducir el resumen de 1 minuto"; `home.promo_video` "am-i.exposed in one minute" / "am-i.exposed en un minuto"; `home.promo_tutorial_link` "Watch the 5-minute tutorial" / "Mira el tutorial de 5 minutos"; About/Welcome line `about.tutorial_link` / `welcome.tutorial_link` "New here? Watch the 5-minute tutorial." / "¿Eres nuevo? Mira el tutorial de 5 minutos.".
- [ ] **Step 3:** targeted tests, type-check, lint; check the header nav still fits at 390 px (the mobile menu) and 1280 px with 6 items. Commit.

---

### Task 5: /tutorial page

**Files:** Create `src/app/tutorial/page.tsx`, `layout.tsx` (metadata like `src/app/guide/layout.tsx`; `robots: { index: VIDEOS_ENABLED }`), `opengraph-image.tsx`, `twitter-image.tsx` (copy the guide's pattern), `src/components/pages/TutorialPage.tsx` + test. Locales.

Behavior (enabled): page frame like other pages (`PageFrame`/`PageShell` pattern used by AboutPage); h1 `tutorial.title` "How to use am-i.exposed"; intro `tutorial.intro`; `PosterVideo` with `tutorialSource(pickVideoLang(lang))`, `tracks = subtitleTracks(lang)`; chapter list (ordered list of buttons `"m:ss  title"`, `aria-label` "Jump to m:ss, title") calling `ref.seek(start[videoLang])`; "Try it yourself" section with buttons for the scans shown in the video, taken from `EXAMPLES` in `src/lib/constants.ts` (the Whirlpool Ashigaru A+, the address-reuse F, the sweep and the WikiLeaks address if present; link to `/#tx=<txid>` / `/#addr=<address>` like the home example cards do). Disabled: a centered note `tutorial.unavailable` "The video tutorial is available on am-i.exposed." with a link to `https://am-i.exposed/tutorial/`.

Keys (en / es; translate the rest): `tutorial.title` "How to use am-i.exposed" / "Cómo usar am-i.exposed"; `tutorial.intro` "A 5-minute walkthrough of the real tool: scanning a transaction, reading the findings, a CoinJoin example, the analyst tools and checking an address." / "Un recorrido de 5 minutos por la herramienta real: escanear una transacción, leer los hallazgos, un ejemplo de CoinJoin, las herramientas de analista y comprobar una dirección."; `tutorial.play` "Play the tutorial" / "Reproducir el tutorial"; `tutorial.video` "am-i.exposed tutorial" / "Tutorial de am-i.exposed"; `tutorial.chapters` "Chapters" / "Capítulos"; `tutorial.jump` "Jump to {{time}}, {{title}}" / "Ir a {{time}}, {{title}}"; `tutorial.chapter.intro` "What am-i.exposed is" / "Qué es am-i.exposed"; `.home` "The home page" / "La página de inicio"; `.scan-tx` "Scanning a transaction" / "Escanear una transacción"; `.coinjoin` "A good example: CoinJoin" / "Un buen ejemplo: CoinJoin"; `.analyst` "Analyst tools" / "Herramientas de analista"; `.address` "Checking an address" / "Comprobar una dirección"; `.more-privacy` "More privacy" / "Más privacidad"; `tutorial.try_title` "Try it yourself" / "Pruébalo tú mismo"; `tutorial.unavailable` "The video tutorial is available on am-i.exposed." / "El tutorial en vídeo está disponible en am-i.exposed.".

- [ ] **Step 1: Tests:** enabled + `es`: source `/media/tutorial-es-16x9.mp4`, default track `es`, chapter "2:49 Un buen ejemplo: CoinJoin" seeks to 169.3; enabled + `pl`: source en, default track `pl`, chapter seeks use en times; disabled: note + link, no `<video>`/poster.
- [ ] **Step 2: Implement.** **Step 3:** targeted tests, type-check, lint, `pnpm build` (flag off) and `NEXT_PUBLIC_VIDEOS=1 pnpm build` both succeed; restore sitemap. Commit.

---

### Task 6: E2E and visual QA

**Files:** Create `e2e/site-videos.spec.ts`; if needed a Playwright project or script that serves a flag-on build (e.g. `scripts/build-videos-e2e.sh` building into `out-videos/` with `NEXT_PUBLIC_VIDEOS=1 next build` and `distDir`/output override, or run the flag-on suite with a second `webServer` on another port). Add `out-videos` to `.gitignore` if used.

- [ ] Flag-off (default `out/`): home has no promo card and makes no `/media/` request; nav/footer have no Tutorial; `/tutorial/` shows the note and makes no `/media/` request (Review Focus 3).
- [ ] Flag-on: at 390x844, no `/media/*.mp4` request before click (posters `.webp` allowed); click the home card -> request for `promo-en-9x16.mp4` (default en) ; at 1280x900 -> `promo-en-16x9.mp4`; with `ami-language=es` in localStorage -> `promo-es-*`; `/tutorial/` with `ami-language=de` -> `tutorial-en-16x9.mp4` and a `track` with `srclang="de"` default; a chapter click sets `currentTime` near its start (Review Focus 1, 2, 5). Serve real files (no mocks).
- [ ] Run serially; full e2e once at the end; type-check, lint, `pnpm test`. Visual QA screenshots (home card, /tutorial, flag-off note) at 390 and 1280 in en/es/de for the controller. Commit.
