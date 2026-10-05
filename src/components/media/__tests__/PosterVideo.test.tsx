// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { createRef } from "react";

vi.mock("react-i18next", async () => {
  const en = (await import("../../../../public/locales/en/common.json")).default as Record<string, string>;
  return { useTranslation: () => ({ t: (k: string) => en[k] ?? k, i18n: { language: "en" } }) };
});

import { PosterVideo, type PosterVideoHandle } from "../PosterVideo";

const tracks = [
  { lang: "en", label: "English", src: "/media/t-en.vtt", default: true },
  { lang: "es", label: "Español", src: "/media/t-es.vtt", default: false },
];
const A = { src: "/media/a.mp4", poster: "/media/a.webp", aspect: "9/16" as const };
const resolve = vi.fn(() => A);
const props = { resolve, poster: "/media/p.webp", aspect: "16/9" as const, tracks, playLabel: "Play promo", videoLabel: "Promo video" };

beforeEach(() => {
  resolve.mockReset().mockImplementation(() => A);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); resolve.mockClear(); vi.restoreAllMocks(); });

describe("PosterVideo", () => {
  it("renders only a poster and button before the click", () => {
    const { container } = render(<PosterVideo {...props} />);
    expect(container.querySelector("video")).toBeNull();
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/media/p.webp");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(screen.getByRole("button", { name: "Play promo" })).toBeTruthy();
  });

  it("mounts the video on click with resolved src and one default track", () => {
    const { container } = render(<PosterVideo {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Play promo" }));
    const v = container.querySelector("video") as HTMLVideoElement;
    expect(v.getAttribute("src")).toBe("/media/a.mp4");
    expect(v.getAttribute("poster")).toBe("/media/a.webp");
    expect(v.playsInline).toBe(true);
    expect(v.getAttribute("preload")).toBe("none");
    expect(v.controls).toBe(true);
    expect(v.getAttribute("aria-label")).toBe("Promo video");
    const t = v.querySelectorAll("track");
    expect(t.length).toBe(2);
    expect(v.querySelectorAll("track[default]").length).toBe(1);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("never re-resolves after mounting", () => {
    const ref = createRef<PosterVideoHandle>();
    const { container } = render(<PosterVideo {...props} ref={ref} />);
    fireEvent.click(screen.getByRole("button", { name: "Play promo" }));
    resolve.mockReturnValueOnce({ src: "/media/b.mp4", poster: "/media/b.webp", aspect: "16/9" as never });
    act(() => ref.current?.seek(5));
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(container.querySelector("video")?.getAttribute("src")).toBe("/media/a.mp4");
  });

  it("shows an error with a link to the file", () => {
    const { container } = render(<PosterVideo {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Play promo" }));
    fireEvent.error(container.querySelector("video") as HTMLVideoElement);
    expect(screen.getByText("The video could not be loaded.")).toBeTruthy();
    const a = screen.getByRole("link", { name: "Open the video file" });
    expect(a.getAttribute("href")).toBe("/media/a.mp4");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("seek before start mounts the video and seeks on metadata", () => {
    const ref = createRef<PosterVideoHandle>();
    const { container } = render(<PosterVideo {...props} ref={ref} />);
    act(() => ref.current?.seek(42));
    const v = container.querySelector("video") as HTMLVideoElement;
    expect(v).toBeTruthy();
    fireEvent.loadedMetadata(v);
    expect(v.currentTime).toBe(42);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("seek on a mounted video sets currentTime at once", () => {
    const ref = createRef<PosterVideoHandle>();
    const { container } = render(<PosterVideo {...props} ref={ref} />);
    fireEvent.click(screen.getByRole("button", { name: "Play promo" }));
    act(() => ref.current?.seek(7));
    expect((container.querySelector("video") as HTMLVideoElement).currentTime).toBe(7);
  });
});
