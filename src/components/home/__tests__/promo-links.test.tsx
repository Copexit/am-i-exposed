// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({ on: true, lang: "en" }));
vi.mock("@/lib/media/videos-enabled", () => ({ get VIDEOS_ENABLED() { return h.on; } }));
vi.mock("react-i18next", async () => {
  const en = (await import("../../../../public/locales/en/common.json")).default as Record<string, string>;
  return {
    useTranslation: () => ({ t: (k: string, o?: { defaultValue?: string }) => en[k] ?? o?.defaultValue ?? k, i18n: { language: h.lang } }),
    Trans: () => null,
  };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/components/pages/PageFrame", () => ({ PageFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/TipJar", () => ({ TipJar: () => null }));

import { PromoCard } from "../PromoCard";
import { HowItWorks } from "../HowItWorks";
import { navItems } from "@/components/chrome/nav";
import { SiteFooter } from "@/components/chrome/SiteFooter";
import { AboutPage } from "@/components/pages/AboutPage";
import { WelcomePage } from "@/components/pages/WelcomePage";

function mm(portrait: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("portrait") ? portrait : false, addEventListener() {}, removeEventListener() {} }));
}
const tutorialLinks = (c: HTMLElement) => c.querySelectorAll('a[href^="/tutorial"]').length;

beforeEach(() => { h.on = true; h.lang = "en"; vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("PromoCard", () => {
  const play = (c: HTMLElement) => { fireEvent.click(screen.getByRole("button", { name: "Play the 1-minute overview" })); return c.querySelector("video")?.getAttribute("src"); };
  it("plays the portrait file on portrait screens", () => {
    mm(true);
    const { container } = render(<PromoCard />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/media/promo-en-9x16.webp");
    expect(play(container)).toBe("/media/promo-en-9x16.mp4");
  });
  it("plays the landscape file otherwise", () => {
    mm(false);
    const { container } = render(<PromoCard />);
    expect(play(container)).toBe("/media/promo-en-16x9.mp4");
  });
  it("uses es for es and en for other languages", () => {
    mm(false);
    h.lang = "es";
    const a = render(<PromoCard />);
    expect(play(a.container)).toBe("/media/promo-es-16x9.mp4");
    cleanup();
    h.lang = "de";
    const b = render(<PromoCard />);
    expect(play(b.container)).toBe("/media/promo-en-16x9.mp4");
  });
  it("updates the poster when the language changes", () => {
    mm(false);
    const { container, rerender } = render(<PromoCard />);
    h.lang = "es";
    rerender(<PromoCard />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/media/promo-es-16x9.webp");
  });
  it("links to the tutorial", () => {
    mm(false);
    const { container } = render(<PromoCard />);
    expect(tutorialLinks(container)).toBe(1);
  });
});

describe("Tutorial links", () => {
  it.each([["enabled", true], ["disabled", false]])("%s", (_n, on) => {
    h.on = on;
    mm(false);
    const want = on ? 1 : 0;
    expect(navItems().some((i) => i.href === "/tutorial/")).toBe(on);
    expect(tutorialLinks(render(<SiteFooter />).container)).toBe(want);
    cleanup();
    expect(tutorialLinks(render(<AboutPage />).container)).toBe(want);
    cleanup();
    expect(tutorialLinks(render(<WelcomePage />).container)).toBe(want);
    cleanup();
    const how = render(<HowItWorks checks={26} />).container;
    expect(tutorialLinks(how)).toBe(want);
    expect(!!how.querySelector("img")).toBe(on);
  });
});
