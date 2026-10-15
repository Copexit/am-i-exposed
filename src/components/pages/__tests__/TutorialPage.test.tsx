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

beforeEach(() => {
  h.on = true;
  h.lang = "en";
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  Element.prototype.scrollIntoView = vi.fn(); // jsdom has none
  history.replaceState(null, "", "/tutorial/");
});
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

  it("graph tutorial: en audio, es subtitles by default in es, chapter seeks", () => {
    h.lang = "es";
    const { container } = render(<TutorialPage />);
    fireEvent.click(screen.getByRole("button", { name: "Reproducir el tutorial del grafo" }));
    const v = [...container.querySelectorAll("video")].find((x) => x.getAttribute("src")?.includes("graph-tutorial")) as HTMLVideoElement;
    expect(v.getAttribute("src")).toBe("/media/graph-tutorial-en-16x9.mp4");
    const tracks = [...v.querySelectorAll("track")].map((t) => [t.getAttribute("srclang"), t.hasAttribute("default")]);
    expect(tracks).toEqual([["en", false], ["es", true]]);
    fireEvent.click(screen.getByRole("button", { name: "Ir a 6:24, Buscar conexión" }));
    expect(v.currentTime).toBeCloseTo(384.43);
  });

  it("graph tutorial: English subtitles by default outside es", () => {
    h.lang = "pl";
    const { container } = render(<TutorialPage />);
    fireEvent.click(screen.getByRole("button", { name: "Play the graph tutorial" }));
    const v = [...container.querySelectorAll("video")].find((x) => x.getAttribute("src")?.includes("graph-tutorial")) as HTMLVideoElement;
    expect(v.querySelector("track[default]")?.getAttribute("srclang")).toBe("en");
  });

  it("a chapter link cues that chapter without playing, and a chapter click writes its link", () => {
    history.replaceState(null, "", "/tutorial/#graph-tutorial-connection");
    const { container } = render(<TutorialPage />);
    const chapter = screen.getByRole("button", { name: "Jump to 6:24, Find connection" });
    expect(chapter.getAttribute("aria-current")).toBe("true");
    expect(container.querySelector("video")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play the graph tutorial" }));
    const v = container.querySelector("video") as HTMLVideoElement;
    expect(v.currentTime).toBeCloseTo(384.43);
    fireEvent.click(screen.getByRole("button", { name: "Jump to 0:43, How to open the graph" }));
    expect(location.hash).toBe("#graph-tutorial-open");
  });

  it("section headings have anchors and copy their link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { container } = render(<TutorialPage />);
    for (const id of ["tutorial", "chapters", "try", "graph-tutorial", "graph-chapters"]) expect(container.querySelector(`#${id}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy link: The transaction graph, in depth" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(`${location.origin}/tutorial/#graph-tutorial`));
    expect(location.hash).toBe("#graph-tutorial");
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
