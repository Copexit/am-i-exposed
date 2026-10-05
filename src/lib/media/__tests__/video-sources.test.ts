import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pickVideoLang, promoSource, tutorialSource, subtitleTracks } from "../video-sources";
import { TUTORIAL_CHAPTERS, formatTime } from "../tutorial-chapters";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");

describe("video-sources", () => {
  it("pickVideoLang", () => {
    expect(pickVideoLang("es")).toBe("es");
    expect(pickVideoLang("es-ES")).toBe("es");
    for (const l of ["de", "pl", "en-US"]) expect(pickVideoLang(l)).toBe("en");
  });
  it("promoSource", () => {
    expect(promoSource("es", true)).toEqual({
      src: "/media/promo-es-9x16.mp4",
      poster: "/media/promo-es-9x16.webp",
      aspect: "9/16",
    });
    expect(promoSource("en", false).src).toBe("/media/promo-en-16x9.mp4");
    expect(promoSource("en", false).aspect).toBe("16/9");
  });
  it("tutorialSource", () => {
    expect(tutorialSource("es")).toEqual({
      src: "/media/tutorial-es-16x9.mp4",
      poster: "/media/tutorial-es-16x9.webp",
      aspect: "16/9",
    });
  });
  it("subtitleTracks", () => {
    const t = subtitleTracks("pl");
    expect(t).toHaveLength(6);
    expect(t.filter((x) => x.default).map((x) => x.lang)).toEqual(["pl"]);
    expect(t.map((x) => x.label)).toEqual(["English", "Español", "Deutsch", "Français", "Português", "Polski"]);
    expect(t[0]?.src).toBe("/media/tutorial-en.vtt");
    expect(subtitleTracks("xx").filter((x) => x.default).map((x) => x.lang)).toEqual(["en"]);
    expect(subtitleTracks("de-AT").find((x) => x.default)?.lang).toBe("de");
  });
});

describe("tutorial chapters", () => {
  it("has 7 chapters with the expected ids and starts", () => {
    expect(TUTORIAL_CHAPTERS.map((c) => c.id)).toEqual(["intro", "home", "scan-tx", "coinjoin", "analyst", "address", "more-privacy"]);
    expect(TUTORIAL_CHAPTERS.map((c) => c.start.en)).toEqual([3.2, 32.33, 66.6, 161.43, 198.6, 225.73, 251.7]);
    expect(TUTORIAL_CHAPTERS.map((c) => c.start.es)).toEqual([3.2, 32.97, 68.77, 169.3, 203.7, 235.7, 261.13]);
  });
  it.each(["en", "es"] as const)("%s starts strictly increase", (l) => {
    const s = TUTORIAL_CHAPTERS.map((c) => c.start[l]);
    s.slice(1).forEach((v, i) => expect(v).toBeGreaterThan(s[i] as number));
  });
  it("formatTime", () => {
    expect(formatTime(161.43)).toBe("2:41");
    expect(formatTime(3.2)).toBe("0:03");
  });
});

describe("build wiring", () => {
  it(".dockerignore excludes public/media", () => {
    expect(read(".dockerignore").split("\n")).toContain("public/media");
  });
  it("deploy.yml enables videos", () => {
    expect(read(".github/workflows/deploy.yml")).toContain('NEXT_PUBLIC_VIDEOS: "1"');
  });
});
