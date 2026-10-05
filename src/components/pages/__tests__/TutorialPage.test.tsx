// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({ on: true, lang: "en" }));
vi.mock("@/lib/media/videos-enabled", () => ({ get VIDEOS_ENABLED() { return h.on; } }));
vi.mock("react-i18next", async () => {
  const dict: Record<string, Record<string, string>> = {
    en: (await import("../../../../public/locales/en/common.json")).default,
    es: (await import("../../../../public/locales/es/common.json")).default,
  };
  return {
    useTranslation: () => ({
      t: (k: string, o?: Record<string, string>) => {
        const s = dict[h.lang]?.[k] ?? dict.en?.[k] ?? k;
        return s.replace(/\{\{(\w+)\}\}/g, (_, n) => o?.[n] ?? "");
      },
      i18n: { language: h.lang },
    }),
  };
});
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import { TutorialPage } from "../TutorialPage";

beforeEach(() => { h.on = true; h.lang = "en"; vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const defaultTrack = (c: HTMLElement) => c.querySelector("track[default]")?.getAttribute("srclang");

describe("TutorialPage", () => {
  it("es: es video, es default track, chapter seeks with es times", () => {
    h.lang = "es";
    const { container } = render(<TutorialPage />);
    fireEvent.click(screen.getByRole("button", { name: "Reproducir el tutorial" }));
    const v = container.querySelector("video") as HTMLVideoElement;
    expect(v.getAttribute("src")).toBe("/media/tutorial-es-16x9.mp4");
    expect(defaultTrack(container)).toBe("es");
    fireEvent.click(screen.getByRole("button", { name: "Ir a 2:49, Un buen ejemplo: CoinJoin" }));
    expect(v.currentTime).toBeCloseTo(169.3);
    expect(screen.getByRole("button", { name: "Ir a 2:49, Un buen ejemplo: CoinJoin" }).textContent).toContain("2:49");
  });

  it("pl: en video, pl default track, en chapter times", () => {
    h.lang = "pl";
    const { container } = render(<TutorialPage />);
    fireEvent.click(screen.getByRole("button", { name: "Jump to 2:41, A good example: CoinJoin" }));
    const v = container.querySelector("video") as HTMLVideoElement;
    expect(v.getAttribute("src")).toBe("/media/tutorial-en-16x9.mp4");
    expect(defaultTrack(container)).toBe("pl");
    expect(v.currentTime).toBeCloseTo(161.43);
  });

  it("chapter times follow the mounted video after a UI language switch", () => {
    h.lang = "es";
    const { container, rerender } = render(<TutorialPage />);
    fireEvent.click(screen.getByRole("button", { name: "Reproducir el tutorial" }));
    h.lang = "en";
    rerender(<TutorialPage />);
    const v = container.querySelector("video") as HTMLVideoElement;
    expect(v.getAttribute("src")).toBe("/media/tutorial-es-16x9.mp4");
    fireEvent.click(screen.getByRole("button", { name: "Jump to 2:49, A good example: CoinJoin" }));
    expect(v.currentTime).toBeCloseTo(169.3);
  });

  it("lists the four example scans", () => {
    const { container } = render(<TutorialPage />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/#tx=5f0080e3f0acfde005b9c7149f12880be273eea01ca3a3b867f642ac9bf273cc");
    expect(hrefs).toContain("/#tx=4c18b982836006cbe54661942f632f10b9cc0072e97a32feeea77abd8c7c8c3c");
    expect(hrefs).toContain("/#addr=1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
    expect(hrefs).toContain("/#addr=bc1pes5mfje89xdr6uh4qu6p4m0r8d6nz3tvgagtwgv99yalqwzyhdzqrl3mnu");
  });

  it("flag off: note and link only", () => {
    h.on = false;
    const { container } = render(<TutorialPage />);
    expect(screen.getByText("The video tutorial is available on am-i.exposed.")).toBeTruthy();
    expect(container.querySelector('a[href="https://am-i.exposed/tutorial/"]')).toBeTruthy();
    expect(container.querySelector("video, img")).toBeNull();
  });
});
